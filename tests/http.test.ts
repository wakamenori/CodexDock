import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { AppServerManager } from "../server/appServerManager";
import type { AppServerSessionLike } from "../server/appServerSession";
import { createApp } from "../server/createApp";
import { RepoRegistry } from "../server/repoRegistry";
import { FakeAppServerSession } from "../server/testing/FakeAppServerSession";
import { ThreadListRefresher } from "../server/threadListRefresher";
import { TurnStateStore } from "../server/turnState";

const jsonHeaders = { "Content-Type": "application/json" };

describe("HTTP API", () => {
  const logger = pino({ level: "silent" });
  let app: ReturnType<typeof createApp>;
  let registry: RepoRegistry;
  let manager: AppServerManager;
  let sessions = new Map<string, FakeAppServerSession>();
  let pickResult: string | null = null;

  beforeEach(async () => {
    sessions = new Map();
    pickResult = null;
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-"));
    registry = new RepoRegistry(tmpDir, logger);
    const sessionFactory = (repo: { repoId: string }): AppServerSessionLike => {
      const session = new FakeAppServerSession(repo.repoId);
      sessions.set(repo.repoId, session);
      return session;
    };
    manager = new AppServerManager({
      registry,
      logger,
      clientInfo: { name: "test", version: "0" },
      sessionFactory,
    });
    const gateway: {
      broadcastToRepo: (repoId: string, message: unknown) => void;
    } = {
      broadcastToRepo: () => {},
    };
    const refresher = new ThreadListRefresher(manager, gateway, logger);
    const turnState = new TurnStateStore();
    app = createApp({
      registry,
      manager,
      logger,
      turnState,
      refresher,
      pathPicker: async () => pickResult,
      defaultModel: "gpt-5.2-codex",
    });
  });

  it("creates repo and lists threads", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    await mkdir(repoDir, { recursive: true });

    const createRes = await app.request("/api/repos", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "demo", path: repoDir }),
    });

    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { repo: { repoId: string } };
    const repoId = createBody.repo.repoId;

    const session = sessions.get(repoId);
    expect(session).toBeTruthy();
    session?.onRequest("thread/list", () => ({
      threads: [
        { id: "thr_1", preview: "hello", updatedAt: "2025-01-01T00:00:00Z" },
      ],
    }));
    session?.onRequest("thread/start", () => ({ thread: { id: "thr_2" } }));
    session?.onRequest("thread/resume", () => ({ ok: true }));
    session?.onRequest("turn/start", () => ({ turn: { id: "turn_1" } }));
    session?.onRequest("turn/interrupt", () => ({ ok: true }));

    const listRes = await app.request("/api/repos");
    const listBody = (await listRes.json()) as { repos: { repoId: string }[] };
    expect(listBody.repos).toHaveLength(1);

    const threadsRes = await app.request(`/api/repos/${repoId}/threads`);
    const threadsBody = (await threadsRes.json()) as {
      threads: { threadId: string }[];
    };
    expect(threadsBody.threads[0].threadId).toBe("thr_1");

    const startThreadRes = await app.request(`/api/repos/${repoId}/threads`, {
      method: "POST",
    });
    const startThreadBody = (await startThreadRes.json()) as {
      thread: { threadId: string };
    };
    expect(startThreadBody.thread.threadId).toBe("thr_2");

    const resumeRes = await app.request(
      `/api/repos/${repoId}/threads/thr_2/resume`,
      {
        method: "POST",
      },
    );
    expect(resumeRes.status).toBe(200);

    const turnRes = await app.request(`/api/repos/${repoId}/turns`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        threadId: "thr_2",
        input: [{ type: "text", text: "hello" }],
      }),
    });
    expect(turnRes.status).toBe(202);

    const cancelRes = await app.request(
      `/api/repos/${repoId}/turns/turn_1/cancel`,
      {
        method: "POST",
      },
    );
    expect(cancelRes.status).toBe(200);
  });

  it("returns selected repo path", async () => {
    pickResult = "/tmp/repo-path";

    const res = await app.request("/api/repos/pick-path", { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe("/tmp/repo-path");
  });

  it("returns 204 when repo path selection is cancelled", async () => {
    pickResult = null;

    const res = await app.request("/api/repos/pick-path", { method: "POST" });

    expect(res.status).toBe(204);
  });

  it("gets and updates model settings", async () => {
    const initialRes = await app.request("/api/settings/model");
    expect(initialRes.status).toBe(200);
    const initialBody = (await initialRes.json()) as {
      storedModel: string | null;
      defaultModel: string | null;
    };
    expect(initialBody.storedModel).toBeNull();
    expect(initialBody.defaultModel).toBe("gpt-5.2-codex");

    const updateRes = await app.request("/api/settings/model", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ model: "gpt-5.2-codex" }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as {
      storedModel: string | null;
    };
    expect(updateBody.storedModel).toBe("gpt-5.2-codex");

    const followRes = await app.request("/api/settings/model");
    const followBody = (await followRes.json()) as {
      storedModel: string | null;
      defaultModel: string | null;
    };
    expect(followBody.storedModel).toBe("gpt-5.2-codex");
    expect(followBody.defaultModel).toBe("gpt-5.2-codex");
  });
});
