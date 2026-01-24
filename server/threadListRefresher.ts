import type { Logger } from "pino";
import type { AppServerManager } from "./appServerManager.js";
import { getArray, getIdString, isRecord } from "./guards.js";
import type { WebSocketGateway } from "./websocketGateway.js";

export class ThreadListRefresher {
  private pending = new Map<string, NodeJS.Timeout>();
  private manager: AppServerManager;
  private gateway: WebSocketGateway;
  private logger: Logger;

  constructor(
    manager: AppServerManager,
    gateway: WebSocketGateway,
    logger: Logger,
  ) {
    this.manager = manager;
    this.gateway = gateway;
    this.logger = logger;
  }

  schedule(repoId: string, delayMs = 600): void {
    if (this.pending.has(repoId)) return;
    const timer = setTimeout(() => {
      this.pending.delete(repoId);
      void this.refresh(repoId);
    }, delayMs);
    this.pending.set(repoId, timer);
  }

  async refresh(repoId: string): Promise<void> {
    try {
      const session = this.manager.getSession(repoId);
      if (!session || session.status !== "connected") return;
      const result = await session.request("thread/list");
      const threads =
        getArray(result, "threads") ??
        getArray(result, "items") ??
        getArray(result, "data") ??
        [];
      const normalized = threads
        .map((item) => {
          const record = isRecord(item) ? item : undefined;
          const threadId =
            getIdString(record?.id) ?? getIdString(record?.threadId);
          return {
            threadId,
            cwd: getStringValue(record, "cwd"),
            preview: getStringValue(record, "preview"),
            updatedAt:
              getTimeValue(record, "updatedAt") ??
              getTimeValue(record, "createdAt"),
          };
        })
        .filter((item) => Boolean(item.threadId));
      this.gateway.broadcastToRepo(repoId, {
        type: "thread_list_updated",
        payload: { repoId, threads: normalized },
      });
    } catch (error) {
      this.logger.warn(
        { component: "thread_list_refresher", repoId, error },
        "refresh_failed",
      );
    }
  }
}

const getStringValue = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const getTimeValue = (
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
