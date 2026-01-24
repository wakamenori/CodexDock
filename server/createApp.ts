import { type Context, Hono } from "hono";
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
import type { RepoRegistry } from "./repoRegistry.js";
import type { ThreadListRefresher } from "./threadListRefresher.js";
import type { TurnStateStore } from "./turnState.js";
import type { JsonObject, JsonValue, RepoEntry } from "./types.js";

const parseJson = async (c: Context) => {
  try {
    return await c.req.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }
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

const mapThreadList = (result: unknown) => {
  const threads =
    getArray(result, "threads") ??
    getArray(result, "items") ??
    getArray(result, "data") ??
    [];
  return threads
    .map((item) => {
      const record = isRecord(item) ? item : undefined;
      const threadId = getIdString(record?.id) ?? getIdString(record?.threadId);
      return {
        threadId,
        cwd: getString(record, "cwd"),
        preview: getString(record, "preview"),
        updatedAt:
          getTimeString(record, "updatedAt") ??
          getTimeString(record, "createdAt"),
      };
    })
    .filter((item) => Boolean(item.threadId));
};

const extractTurnId = (result: unknown) => {
  const record = isRecord(result) ? result : undefined;
  const turnRecord = getRecord(record, "turn");
  return (
    getIdString(turnRecord?.id) ??
    getIdString(record?.turnId) ??
    getIdString(record?.id)
  );
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

export const createApp = (options: {
  registry: RepoRegistry;
  manager: AppServerManager;
  logger: Logger;
  turnState: TurnStateStore;
  refresher: ThreadListRefresher;
}) => {
  const { registry, manager, logger, turnState, refresher } = options;
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
    } catch (error) {
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
      return c.json({ threads: mapThreadList(result) });
    } catch (error) {
      throw appServerError(error);
    }
  });

  app.post("/api/repos/:repoId/threads", async (c) => {
    const repoId = c.req.param("repoId");
    const repo = await requireRepo(repoId);
    try {
      const session = await manager.getOrStart(repoId);
      const result = await session.request("thread/start", {
        cwd: repo.path,
      });
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

  app.post("/api/repos/:repoId/turns/:turnId/cancel", async (c) => {
    const repoId = c.req.param("repoId");
    const turnId = c.req.param("turnId");
    await requireRepo(repoId);
    const status = turnState.get(repoId, turnId);
    if (status && status !== "running") {
      return c.json({ turn: { turnId, status: "already_finished" } });
    }
    try {
      const session = await manager.getOrStart(repoId);
      await session.request("turn/interrupt", { turnId });
      return c.json({ turn: { turnId, status: "interrupt_requested" } });
    } catch (error) {
      throw appServerError(error);
    }
  });

  return app;
};
