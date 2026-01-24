import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import {
  AppServerSession,
  type AppServerSessionLike,
} from "./appServerSession.js";
import type {
  RepoEntry,
  RpcNotification,
  RpcRequest,
  RpcResponse,
  SessionStatus,
} from "./types.js";

export type SessionFactory = (repo: RepoEntry) => AppServerSessionLike;

export class AppServerManager extends EventEmitter {
  private sessions = new Map<string, AppServerSessionLike>();
  private registry: {
    list: () => Promise<RepoEntry[]>;
    get: (repoId: string) => Promise<RepoEntry | undefined>;
  };
  private logger: Logger;
  private sessionFactory: SessionFactory;

  constructor(options: {
    registry: {
      list: () => Promise<RepoEntry[]>;
      get: (repoId: string) => Promise<RepoEntry | undefined>;
    };
    logger: Logger;
    sessionFactory?: SessionFactory;
    clientInfo: { name: string; version: string };
  }) {
    super();
    this.registry = options.registry;
    this.logger = options.logger;
    this.sessionFactory =
      options.sessionFactory ??
      ((repo) =>
        new AppServerSession({
          repoId: repo.repoId,
          logger: this.logger,
          clientInfo: options.clientInfo,
        }));
  }

  async initAll(): Promise<void> {
    const repos = await this.registry.list();
    for (const repo of repos) {
      try {
        await this.getOrStart(repo.repoId);
      } catch (error) {
        this.logger.error(
          { component: "app_server_manager", repoId: repo.repoId, error },
          "session_start_failed",
        );
      }
    }
  }

  async getOrStart(repoId: string): Promise<AppServerSessionLike> {
    const repo = await this.registry.get(repoId);
    if (!repo) {
      throw new Error("Repository not found");
    }
    const existing = this.sessions.get(repoId);
    if (existing) {
      if (existing.status === "connected") return existing;
      if (existing.status === "starting") {
        await existing.waitForConnected();
        return existing;
      }
      await existing.stop();
      this.sessions.delete(repoId);
    }

    const session = this.sessionFactory(repo);
    this.attachSession(repoId, session);
    this.sessions.set(repoId, session);
    await session.start();
    return session;
  }

  getSession(repoId: string): AppServerSessionLike | undefined {
    return this.sessions.get(repoId);
  }

  getStatus(repoId: string): SessionStatus {
    return this.sessions.get(repoId)?.status ?? "stopped";
  }

  async stop(repoId: string): Promise<void> {
    const session = this.sessions.get(repoId);
    if (!session) return;
    await session.stop();
    this.sessions.delete(repoId);
    this.emit("session_status", { repoId, status: "stopped" as SessionStatus });
  }

  async stopAll(): Promise<void> {
    const entries = Array.from(this.sessions.entries());
    for (const [repoId, session] of entries) {
      await session.stop();
      this.sessions.delete(repoId);
    }
  }

  sendResponse(repoId: string, message: RpcResponse): void {
    const session = this.sessions.get(repoId);
    if (!session) {
      this.logger.warn(
        { component: "app_server_manager", repoId },
        "response_without_session",
      );
      return;
    }
    session.sendResponse(message);
  }

  private attachSession(repoId: string, session: AppServerSessionLike): void {
    session.on("notification", (message: RpcNotification) => {
      this.emit("session_notification", { repoId, message });
    });

    session.on("request", (message: RpcRequest) => {
      this.emit("session_request", { repoId, message });
    });

    session.on("status", (status: SessionStatus) => {
      this.emit("session_status", { repoId, status });
    });
  }
}
