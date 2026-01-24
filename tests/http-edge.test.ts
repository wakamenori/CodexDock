import { mkdtemp } from "node:fs/promises";
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

type TestContext = {
  app: ReturnType<typeof createApp>;
  registry: RepoRegistry;
  manager: AppServerManager;
  sessions: Map<string, FakeAppServerSession>;
  turnState: TurnStateStore;
};

const createContext = async (): Promise<TestContext> => {
  const logger = pino({ level: "silent" });
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-data-"));
  const registry = new RepoRegistry(dataDir, logger);
  const sessions = new Map<string, FakeAppServerSession>();
  const sessionFactory = (repo: { repoId: string }): AppServerSessionLike => {
    const session = new FakeAppServerSession(repo.repoId);
    sessions.set(repo.repoId, session);
    return session;
  };
  const manager = new AppServerManager({
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
  const app = createApp({ registry, manager, logger, turnState, refresher });
  return { app, registry, manager, sessions, turnState };
};

describe("HTTP API edge cases", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createContext();
  });

  it("rejects repo creation when name or path is missing", async () => {
    const res = await context.app.request("/api/repos", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "demo" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("rejects updates that try to change path", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const repo = await context.registry.create("demo", repoDir);

    const res = await context.app.request(`/api/repos/${repo.repoId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ path: "/tmp" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("rejects turns without threadId or input", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const repo = await context.registry.create("demo", repoDir);

    const res = await context.app.request(`/api/repos/${repo.repoId}/turns`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ input: [{ type: "text", text: "hello" }] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns already_finished when canceling a completed turn", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const repo = await context.registry.create("demo", repoDir);

    context.turnState.updateFromNotification(repo.repoId, {
      method: "turn/completed",
      params: { turn: { id: "turn_9" }, status: "completed" },
    });

    const res = await context.app.request(
      `/api/repos/${repo.repoId}/turns/turn_9/cancel`,
      {
        method: "POST",
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      turn: { turnId: string; status: string };
    };
    expect(body.turn.turnId).toBe("turn_9");
    expect(body.turn.status).toBe("already_finished");
  });

  it("maps thread list responses with numeric timestamps", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const repo = await context.registry.create("demo", repoDir);

    await context.manager.getOrStart(repo.repoId);
    const session = context.sessions.get(repo.repoId);
    session?.onRequest("thread/list", () => ({
      threads: [
        { id: 7, preview: "hello", updatedAt: 1_700_000_000 },
        { threadId: "thr_8", preview: "world", createdAt: 1_700_000_000_000 },
      ],
    }));

    const res = await context.app.request(`/api/repos/${repo.repoId}/threads`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: { threadId: string; preview?: string; updatedAt?: string }[];
    };

    expect(body.threads).toEqual([
      {
        threadId: "7",
        preview: "hello",
        updatedAt: new Date(1_700_000_000 * 1000).toISOString(),
      },
      {
        threadId: "thr_8",
        preview: "world",
        updatedAt: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
  });
});
