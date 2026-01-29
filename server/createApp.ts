import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Context, Hono } from "hono";
import { serveStatic } from "hono/serve-static";
import type { Logger } from "pino";
import type { AppServerManager } from "./appServerManager.js";
import { ApiError, badRequest, jsonError, notFound } from "./errors.js";
import {
  getArray,
  getIdString,
  getRecord,
  getString,
  isRecord,
} from "./guards.js";
import { httpLogger } from "./logger.js";
import type { RepoPathPicker } from "./pathPicker.js";
import { pickRepoPath } from "./pathPicker.js";
import type { RepoRegistry } from "./repoRegistry.js";
import { getLastMessageAt } from "./rolloutLastMessage.js";
import type { ThreadListRefresher } from "./threadListRefresher.js";
import type { TurnStateStore } from "./turnState.js";
import type {
  JsonObject,
  JsonValue,
  PermissionMode,
  RepoEntry,
} from "./types.js";

const parseJson = async (c: Context) => {
  try {
    return await c.req.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }
};

const parseJsonOptional = async (c: Context) => {
  const text = await c.req.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest("Invalid JSON body");
  }
};

type FormDataFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name?: string;
  type?: string;
  size?: number;
};

const isFormDataFile = (value: unknown): value is FormDataFile => {
  if (!value || typeof value !== "object") return false;
  return (
    "arrayBuffer" in value &&
    typeof (value as FormDataFile).arrayBuffer === "function"
  );
};

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
};

const resolveImageExtension = (name: string | undefined, type?: string) => {
  const ext = name ? path.extname(name).toLowerCase() : "";
  if (ext) return ext;
  if (type && IMAGE_EXTENSIONS[type]) return IMAGE_EXTENSIONS[type];
  return "";
};

const getTimeString = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  if (!record) return undefined;
  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
  }
  return undefined;
};

const mapThreadList = async (result: unknown) => {
  const threads =
    getArray(result, "threads") ??
    getArray(result, "items") ??
    getArray(result, "data") ??
    [];
  const mapped = await Promise.all(
    threads.map(async (item) => {
      const record = isRecord(item) ? item : undefined;
      const threadId = getIdString(record?.id) ?? getIdString(record?.threadId);
      if (!threadId) return null;
      const threadPath = getString(record, "path");
      const lastMessageAt = await getLastMessageAt(threadPath);
      const base: {
        threadId: string;
        cwd?: string;
        preview?: string;
        createdAt?: string;
        updatedAt?: string;
        lastMessageAt?: string;
      } = {
        threadId,
        cwd: getString(record, "cwd"),
        preview: getString(record, "preview"),
        createdAt:
          getTimeString(record, "createdAt") ??
          getTimeString(record, "updatedAt"),
        updatedAt:
          getTimeString(record, "updatedAt") ??
          getTimeString(record, "createdAt"),
      };
      if (lastMessageAt) {
        base.lastMessageAt = lastMessageAt;
      }
      return base;
    }),
  );
  return mapped.filter((item): item is NonNullable<typeof item> =>
    Boolean(item),
  );
};

const summarizeThreadListRaw = (result: unknown) => {
  const threads =
    getArray(result, "threads") ??
    getArray(result, "items") ??
    getArray(result, "data") ??
    [];
  return threads.map((item) => {
    const record = isRecord(item) ? item : undefined;
    const preview = getString(record, "preview");
    return {
      id: record?.id ?? null,
      threadId: record?.threadId ?? null,
      createdAt: record?.createdAt ?? null,
      updatedAt: record?.updatedAt ?? null,
      previewLength: preview?.length ?? 0,
    };
  });
};

const summarizeNormalizedThreads = (
  threads: Awaited<ReturnType<typeof mapThreadList>>,
) =>
  threads.map((thread) => ({
    threadId: thread.threadId,
    createdAt: thread.createdAt ?? null,
    updatedAt: thread.updatedAt ?? null,
    lastMessageAt: thread.lastMessageAt ?? null,
    previewLength: thread.preview?.length ?? 0,
  }));

const extractTurnId = (result: unknown) => {
  const record = isRecord(result) ? result : undefined;
  const turnRecord = getRecord(record, "turn");
  return (
    getIdString(turnRecord?.id) ??
    getIdString(record?.turnId) ??
    getIdString(record?.id)
  );
};

const extractReviewThreadId = (result: unknown) => {
  const record = isRecord(result) ? result : undefined;
  return (
    getIdString(record?.reviewThreadId) ?? getIdString(record?.review_thread_id)
  );
};

const normalizePermissionMode = (value: unknown): PermissionMode => {
  if (value === "FullAccess" || value === "ReadOnly" || value === "OnRequest") {
    return value;
  }
  return "ReadOnly";
};

const requireReviewTarget = (target: Record<string, unknown>) => {
  const targetType = getString(target, "type");
  if (!targetType) {
    throw badRequest("target.type is required", { field: "target.type" });
  }
  if (targetType === "uncommittedChanges") return targetType;
  if (targetType === "baseBranch") {
    const branch = getString(target, "branch");
    if (!branch) {
      throw badRequest("target.branch is required", { field: "target.branch" });
    }
    return targetType;
  }
  if (targetType === "commit") {
    const sha = getString(target, "sha");
    if (!sha) {
      throw badRequest("target.sha is required", { field: "target.sha" });
    }
    return targetType;
  }
  if (targetType === "custom") {
    const instructions = getString(target, "instructions");
    if (!instructions) {
      throw badRequest("target.instructions is required", {
        field: "target.instructions",
      });
    }
    return targetType;
  }
  throw badRequest("target.type is invalid", { field: "target.type" });
};

const extractThreadId = (result: unknown) => {
  const record = isRecord(result) ? result : undefined;
  const threadRecord = getRecord(record, "thread");
  return (
    getIdString(threadRecord?.id) ??
    getIdString(record?.threadId) ??
    getIdString(record?.id)
  );
};

const appServerError = (error: unknown) =>
  new ApiError(500, "app_server_error", "app-server request failed", {
    appServerError: {
      message: error instanceof Error ? error.message : "unknown",
    },
  });

type CreateAppOptions = {
  registry: RepoRegistry;
  manager: AppServerManager;
  logger: Logger;
  turnState: TurnStateStore;
  refresher: ThreadListRefresher;
  pathPicker?: RepoPathPicker;
  staticRoot?: string;
  uploadDir?: string;
  defaultModel?: string | null;
};

export const createApp = (options: CreateAppOptions) => {
  const { registry, manager, logger, turnState, refresher } = options;
  const pathPicker = options.pathPicker ?? pickRepoPath;
  const staticRoot = options.staticRoot;
  const uploadDir =
    options.uploadDir ?? path.join(process.cwd(), "data", "uploads");
  const defaultModel = options.defaultModel ?? null;
  const app = new Hono();

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    httpLogger.logger.info(
      {
        component: "http",
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - start,
      },
      "request",
    );
  });

  app.onError((error, c) => {
    logger.error({ component: "http", error }, "request_error");
    return jsonError(c, error as Error);
  });

  const requireRepo = async (repoId: string): Promise<RepoEntry> => {
    const repo = await registry.get(repoId);
    if (!repo) {
      throw notFound("Repository not found", { repoId });
    }
    return repo;
  };

  app.get("/api/repos", async (c) => {
    const repos = await registry.list();
    return c.json({ repos });
  });

  app.get("/api/settings/model", async (c) => {
    const settings = await registry.getSettings();
    return c.json({
      storedModel: settings.model ?? null,
      defaultModel,
    });
  });

  app.get("/api/settings/reasoning-effort", async (c) => {
    const settings = await registry.getSettings();
    return c.json({
      storedReasoningEffort: settings.reasoningEffort ?? null,
    });
  });

  app.get("/api/settings/permission-mode", async (c) => {
    const settings = await registry.getSettings();
    return c.json({
      defaultMode: normalizePermissionMode(
        settings.permissionMode ?? "FullAccess",
      ),
    });
  });

  app.put("/api/settings/model", async (c) => {
    const body = await parseJson(c);
    if (!isRecord(body)) {
      throw badRequest("model is required", { field: "model" });
    }
    const hasModel = Object.hasOwn(body, "model");
    if (!hasModel) {
      throw badRequest("model is required", { field: "model" });
    }
    const rawModel = body.model;
    if (rawModel !== null && typeof rawModel !== "string") {
      throw badRequest("model must be a string or null", { field: "model" });
    }
    const settings = await registry.updateSettings({
      model: rawModel ?? null,
    });
    return c.json({ storedModel: settings.model ?? null });
  });

  app.put("/api/settings/reasoning-effort", async (c) => {
    const body = await parseJson(c);
    if (!isRecord(body)) {
      throw badRequest("reasoningEffort is required", {
        field: "reasoningEffort",
      });
    }
    const hasEffort = Object.hasOwn(body, "reasoningEffort");
    if (!hasEffort) {
      throw badRequest("reasoningEffort is required", {
        field: "reasoningEffort",
      });
    }
    const rawEffort = body.reasoningEffort;
    if (rawEffort !== null && typeof rawEffort !== "string") {
      throw badRequest("reasoningEffort must be a string or null", {
        field: "reasoningEffort",
      });
    }
    const settings = await registry.updateSettings({
      reasoningEffort: rawEffort ?? null,
    });
    return c.json({ storedReasoningEffort: settings.reasoningEffort ?? null });
  });

  app.post("/api/uploads", async (c) => {
    let formData: unknown;
    try {
      formData = await c.req.formData();
    } catch {
      throw badRequest("Invalid multipart form data");
    }
    if (!formData || typeof formData !== "object") {
      throw badRequest("Invalid multipart form data");
    }
    const entries = (
      formData as { getAll: (name: string) => unknown[] }
    ).getAll("files");
    const files: FormDataFile[] = entries.filter(isFormDataFile);
    if (files.length === 0) {
      throw badRequest("No files uploaded", { field: "files" });
    }
    await mkdir(uploadDir, { recursive: true });
    const uploads: JsonObject[] = [];
    for (const file of files) {
      const mimeType = typeof file.type === "string" ? file.type : "";
      if (!mimeType.startsWith("image/")) {
        throw badRequest("Only image files are supported", {
          name: file.name ?? null,
          type: mimeType,
        });
      }
      const extension = resolveImageExtension(file.name, mimeType);
      const id = randomUUID();
      const fileName = `${id}${extension}`;
      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);
      uploads.push({
        id,
        name: file.name ?? fileName,
        path: filePath,
        url: `/api/uploads/${encodeURIComponent(fileName)}`,
        size: typeof file.size === "number" ? file.size : buffer.length,
        type: mimeType,
      });
    }
    return c.json({ uploads }, 201);
  });

  app.post("/api/repos/pick-path", async (c) => {
    try {
      const path = await pathPicker();
      if (!path) return c.body(null, 204);
      return c.json({ path });
    } catch (error) {
      throw new ApiError(
        500,
        "picker_failed",
        "Failed to select repository path",
        {
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
    }
  });

  app.post("/api/repos", async (c) => {
    const body = await parseJson(c);
    if (!isRecord(body)) {
      throw badRequest("name and path are required", { field: "name" });
    }
    const name = getString(body, "name");
    const path = getString(body, "path");
    if (
      !name ||
      !path ||
      typeof name !== "string" ||
      typeof path !== "string"
    ) {
      throw badRequest("name and path are required", { field: "name" });
    }
    const repo = await registry.create(name, path);
    try {
      await manager.getOrStart(repo.repoId);
    } catch (error) {
      logger.error(
        { component: "repo_create", repoId: repo.repoId, error },
        "session_start_failed",
      );
    }
    return c.json({ repo }, 201);
  });

  app.patch("/api/repos/:repoId", async (c) => {
    const repoId = c.req.param("repoId");
    const body = await parseJson(c);
    if (!isRecord(body) || Object.keys(body).length === 0) {
      throw badRequest("Patch body required");
    }
    if ("path" in body) {
      throw badRequest("path cannot be updated", { field: "path" });
    }
    const repo = await registry.update(repoId, {
      name: getString(body, "name"),
      lastOpenedThreadId: getString(body, "lastOpenedThreadId"),
    });
    return c.json({ repo });
  });

  app.delete("/api/repos/:repoId", async (c) => {
    const repoId = c.req.param("repoId");
    await requireRepo(repoId);
    try {
      await manager.stop(repoId);
    } catch {
      throw new ApiError(500, "session_stop_failed", "Failed to stop session", {
        repoId,
      });
    }
    await registry.remove(repoId);
    return c.body(null, 204);
  });

  app.post("/api/repos/:repoId/session/start", async (c) => {
    const repoId = c.req.param("repoId");
    await requireRepo(repoId);
    try {
      await manager.getOrStart(repoId);
      return c.json({ status: "started" });
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.post("/api/repos/:repoId/session/stop", async (c) => {
    const repoId = c.req.param("repoId");
    await requireRepo(repoId);
    try {
      await manager.stop(repoId);
      return c.json({ status: "stopped" });
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.get("/api/repos/:repoId/session/status", async (c) => {
    const repoId = c.req.param("repoId");
    await requireRepo(repoId);
    return c.json({ status: manager.getStatus(repoId) });
  });

  app.get("/api/repos/:repoId/threads", async (c) => {
    const repoId = c.req.param("repoId");
    await requireRepo(repoId);
    try {
      const session = await manager.getOrStart(repoId);
      const result = await session.request("thread/list");
      const rawSummary = summarizeThreadListRaw(result);
      logger.info(
        {
          component: "thread_list_http",
          repoId,
          threadCount: rawSummary.length,
          threads: rawSummary,
        },
        "thread_list_raw",
      );
      const normalized = await mapThreadList(result);
      logger.info(
        {
          component: "thread_list_http",
          repoId,
          threadCount: normalized.length,
          threads: summarizeNormalizedThreads(normalized),
        },
        "thread_list_normalized",
      );
      return c.json({ threads: normalized });
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.get("/api/repos/:repoId/models", async (c) => {
    const repoId = c.req.param("repoId");
    await requireRepo(repoId);
    try {
      const session = await manager.getOrStart(repoId);
      const result = await session.request("model/list");
      return c.json({ result } as JsonObject);
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.post("/api/repos/:repoId/threads", async (c) => {
    const repoId = c.req.param("repoId");
    const repo = await requireRepo(repoId);
    try {
      const body = await parseJsonOptional(c);
      if (body !== undefined && !isRecord(body)) {
        throw badRequest("Invalid JSON body");
      }
      const model = getString(body, "model");
      const session = await manager.getOrStart(repoId);
      const params: JsonObject = { cwd: repo.path };
      if (model) {
        params.model = model;
      }
      const result = await session.request("thread/start", params);
      const threadId = extractThreadId(result);
      if (!threadId) {
        throw new Error("thread id missing");
      }
      await refresher.refresh(repoId);
      return c.json({ thread: { threadId } }, 201);
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.post("/api/repos/:repoId/threads/:threadId/resume", async (c) => {
    const repoId = c.req.param("repoId");
    const threadId = c.req.param("threadId");
    await requireRepo(repoId);
    try {
      const session = await manager.getOrStart(repoId);
      const result = await session.request("thread/resume", { threadId });
      await refresher.refresh(repoId);
      return c.json({ thread: { threadId }, resume: result });
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.post("/api/repos/:repoId/turns", async (c) => {
    const repoId = c.req.param("repoId");
    const repo = await requireRepo(repoId);
    const body = await parseJson(c);
    if (!isRecord(body)) {
      throw badRequest("threadId and input are required", {
        field: "threadId",
      });
    }
    const threadId = getString(body, "threadId");
    const input = getArray(body, "input") as JsonValue[] | undefined;
    if (!threadId || !input) {
      throw badRequest("threadId and input are required", {
        field: "threadId",
      });
    }
    try {
      const session = await manager.getOrStart(repoId);
      const params: JsonObject = {
        threadId,
        input,
        cwd: repo.path,
      };
      const options = getRecord(body, "options");
      if (options) {
        for (const [key, value] of Object.entries(options)) {
          params[key] = value as JsonValue;
        }
      }
      const result = await session.request("turn/start", params);
      const turnId = extractTurnId(result);
      if (!turnId) {
        throw new Error("turn id missing");
      }
      return c.json({ turn: { turnId, status: "running" } }, 202);
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.post("/api/repos/:repoId/reviews", async (c) => {
    const repoId = c.req.param("repoId");
    await requireRepo(repoId);
    const body = await parseJson(c);
    if (!isRecord(body)) {
      throw badRequest("threadId and target are required", {
        field: "threadId",
      });
    }
    const threadId = getString(body, "threadId");
    const target = getRecord(body, "target");
    const delivery = getString(body, "delivery");
    if (!threadId || !target) {
      throw badRequest("threadId and target are required", {
        field: "threadId",
      });
    }
    if (delivery && delivery !== "inline" && delivery !== "detached") {
      throw badRequest("delivery must be inline or detached", {
        field: "delivery",
      });
    }
    requireReviewTarget(target);
    try {
      const session = await manager.getOrStart(repoId);
      const params: JsonObject = {
        threadId,
        target: target as JsonObject,
      };
      if (delivery) {
        params.delivery = delivery;
      }
      const result = await session.request("review/start", params);
      const turnId = extractTurnId(result);
      if (!turnId) {
        throw new Error("turn id missing");
      }
      const reviewThreadId = extractReviewThreadId(result) ?? null;
      return c.json(
        { turn: { turnId, status: "running" }, reviewThreadId },
        202,
      );
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.post("/api/repos/:repoId/turns/:turnId/cancel", async (c) => {
    const repoId = c.req.param("repoId");
    const turnId = c.req.param("turnId");
    await requireRepo(repoId);
    const status = turnState.get(repoId, turnId);
    if (status && status !== "running") {
      return c.json({ turn: { turnId, status: "already_finished" } });
    }
    try {
      const body = await parseJsonOptional(c);
      if (!isRecord(body)) {
        throw badRequest("threadId is required", { field: "threadId" });
      }
      const threadId = getString(body, "threadId");
      if (!threadId) {
        throw badRequest("threadId is required", { field: "threadId" });
      }
      const session = await manager.getOrStart(repoId);
      await session.request("turn/interrupt", { threadId, turnId });
      return c.json({ turn: { turnId, status: "interrupt_requested" } });
    } catch (error) {
      throw appServerError(error);
    }
  });

  const resolvedUploadRoot = path.resolve(uploadDir);
  const imageContentTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  };

  app.get("/api/uploads/:fileName", async (c) => {
    const fileName = c.req.param("fileName");
    if (!fileName) {
      throw notFound("Upload not found");
    }
    const safeName = path.basename(fileName);
    if (safeName !== fileName) {
      throw notFound("Upload not found");
    }
    const filePath = path.join(resolvedUploadRoot, safeName);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(resolvedUploadRoot)) {
      throw notFound("Upload not found");
    }
    try {
      const content = await readFile(resolvedPath);
      const ext = path.extname(safeName).toLowerCase();
      const contentType = imageContentTypes[ext] ?? "application/octet-stream";
      c.header("Content-Type", contentType);
      return c.body(content);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw notFound("Upload not found");
      }
      throw error;
    }
  });

  logger.info(
    { component: "uploads", root: resolvedUploadRoot },
    "uploads_enabled",
  );

  const isReservedPath = (requestPath: string) =>
    requestPath === "/api" ||
    requestPath.startsWith("/api/") ||
    requestPath === "/ws" ||
    requestPath.startsWith("/ws/");

  if (staticRoot) {
    const resolvedRoot = path.resolve(staticRoot);
    const indexFile = path.join(resolvedRoot, "index.html");
    const staticMiddleware = serveStatic({
      root: resolvedRoot,
      getContent: async (filePath) => {
        try {
          return await readFile(filePath);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT") return null;
          throw error;
        }
      },
      isDir: async (filePath) => {
        try {
          const stats = await stat(filePath);
          return stats.isDirectory();
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT") return false;
          throw error;
        }
      },
    });

    app.get("*", async (c, next) => {
      if (isReservedPath(c.req.path)) return next();
      return staticMiddleware(c, next);
    });

    app.get("*", async (c) => {
      if (isReservedPath(c.req.path)) {
        return c.text("Not Found", 404);
      }
      const accept = c.req.header("Accept") ?? "";
      if (!accept.includes("text/html")) {
        return c.text("Not Found", 404);
      }
      try {
        const content = await readFile(indexFile);
        c.header("Content-Type", "text/html");
        return c.body(content);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          return c.text("Not Found", 404);
        }
        throw error;
      }
    });

    logger.info({ component: "static", root: resolvedRoot }, "static_enabled");
  }

  return app;
};
