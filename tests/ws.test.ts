import { mkdtemp } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AppServerBridge } from "../server/appServerBridge";
import { AppServerManager } from "../server/appServerManager";
import type { AppServerSessionLike } from "../server/appServerSession";
import { createApp } from "../server/createApp";
import { RepoRegistry } from "../server/repoRegistry";
import { FakeAppServerSession } from "../server/testing/FakeAppServerSession";
import { ThreadListRefresher } from "../server/threadListRefresher";
import { TurnStateStore } from "../server/turnState";
import { WebSocketGateway } from "../server/websocketGateway";

const waitForMessage = (
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("timeout"));
    }, timeoutMs);

    const onMessage = (data: unknown) => {
      let raw: string | undefined;
      if (typeof data === "string") {
        raw = data;
      } else if (data instanceof Buffer) {
        raw = data.toString();
      } else if (data instanceof ArrayBuffer) {
        raw = Buffer.from(data).toString();
      } else if (ArrayBuffer.isView(data)) {
        raw = Buffer.from(data.buffer).toString();
      }
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const msg =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : undefined;
      if (msg && predicate(msg)) {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve(msg);
      }
    };

    ws.on("message", onMessage);
  });

describe("WebSocket", () => {
  it("subscribes and receives session status", async () => {
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
    const gateway = new WebSocketGateway({ logger, registry, manager });
    const refresher = new ThreadListRefresher(manager, gateway, logger);
    const turnState = new TurnStateStore();
    const bridge = new AppServerBridge({
      manager,
      gateway,
      turnState,
      refresher,
      logger,
    });

    const app = createApp({
      registry,
      manager,
      logger,
      turnState,
      refresher,
      pathPicker: async () => null,
    });
    const server = createServer(getRequestListener(app.fetch));
    gateway.attach(server);

    const ready = await new Promise<boolean>((resolve, reject) => {
      const onUncaught = (error: NodeJS.ErrnoException) => {
        cleanup();
        if (error.code === "EPERM") {
          resolve(false);
          return;
        }
        reject(error);
      };
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        if (error.code === "EPERM") {
          resolve(false);
          return;
        }
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve(true);
      };
      const cleanup = () => {
        process.off("uncaughtException", onUncaught);
        server.off("error", onError);
        server.off("listening", onListening);
      };
      process.once("uncaughtException", onUncaught);
      server.once("error", onError);
      server.once("listening", onListening);
      try {
        server.listen(0, "127.0.0.1");
      } catch (error) {
        cleanup();
        const err = error as NodeJS.ErrnoException;
        if (err.code === "EPERM") {
          resolve(false);
          return;
        }
        reject(error);
      }
    });

    if (!ready) {
      return;
    }

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve test server port");
    }
    const port = address.port;
    bridge.init();

    const repoDir = await mkdtemp(path.join(os.tmpdir(), "codexdock-repo-"));
    const repo = await registry.create("demo", repoDir);
    await manager.getOrStart(repo.repoId);

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve) => ws.once("open", resolve));

    const ackPromise = waitForMessage(
      ws,
      (msg) => msg.type === "subscribe_ack",
    );
    const statusPromise = waitForMessage(
      ws,
      (msg) => msg.type === "session_status",
    );

    ws.send(
      JSON.stringify({
        type: "subscribe",
        requestId: "req-1",
        payload: { repoId: repo.repoId },
      }),
    );

    const ack = await ackPromise;
    expect((ack.payload as { repoId?: string }).repoId).toBe(repo.repoId);

    const status = await statusPromise;
    expect((status.payload as { status?: string }).status).toBe("connected");

    const session = sessions.get(repo.repoId);
    const notifPromise = waitForMessage(
      ws,
      (msg) => msg.type === "app_server_notification",
    );
    session?.emitNotification("turn/started", { turn: { id: "turn_1" } });
    const notif = await notifPromise;
    expect(
      (
        (notif.payload as { message?: { method?: string } }).message?.method ??
        ""
      ).toString(),
    ).toBe("turn/started");

    ws.close();
    server.close();
  });
});
