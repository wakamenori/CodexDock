import type { Logger } from "pino";
import type { AppServerManager } from "./appServerManager.js";
import { notifyOs } from "./osNotification.js";
import type { RepoRegistry } from "./repoRegistry.js";
import type { ThreadListRefresher } from "./threadListRefresher.js";
import type { TurnStateStore } from "./turnState.js";
import type { RpcNotification, RpcRequest } from "./types.js";
import type { WebSocketGateway } from "./websocketGateway.js";

type NotificationSender = (input: {
  title: string;
  message: string;
}) => Promise<void>;

export class AppServerBridge {
  private manager: AppServerManager;
  private gateway: WebSocketGateway;
  private turnState: TurnStateStore;
  private refresher: ThreadListRefresher;
  private registry: RepoRegistry;
  private logger: Logger;
  private notify: NotificationSender;

  constructor(options: {
    manager: AppServerManager;
    gateway: WebSocketGateway;
    turnState: TurnStateStore;
    refresher: ThreadListRefresher;
    registry: RepoRegistry;
    logger: Logger;
    notify?: NotificationSender;
  }) {
    this.manager = options.manager;
    this.gateway = options.gateway;
    this.turnState = options.turnState;
    this.refresher = options.refresher;
    this.registry = options.registry;
    this.logger = options.logger;
    this.notify =
      options.notify ??
      ((input) => notifyOs({ ...input, logger: this.logger }));
  }

  init(): void {
    this.manager.on(
      "session_notification",
      ({ repoId, message }: { repoId: string; message: RpcNotification }) => {
        this.turnState.updateFromNotification(repoId, message);
        if (
          message.method === "turn/completed" ||
          message.method === "turn/failed"
        ) {
          this.refresher.schedule(repoId);
        }
        if (
          message.method === "turn/completed" ||
          message.method === "turn/failed" ||
          message.method === "turn/error"
        ) {
          void this.handleTurnNotification(repoId, message);
        }
        this.gateway.broadcastToRepo(repoId, {
          type: "app_server_notification",
          payload: { repoId, message },
        });
      },
    );

    this.manager.on(
      "session_request",
      ({ repoId, message }: { repoId: string; message: RpcRequest }) => {
        if (message.method.includes("requestApproval")) {
          void this.handleApprovalNotification(repoId, message);
        }
        this.gateway.broadcastToRepo(repoId, {
          type: "app_server_request",
          payload: { repoId, message },
        });
      },
    );

    this.manager.on(
      "session_status",
      ({ repoId, status }: { repoId: string; status: string }) => {
        this.gateway.broadcastToRepo(repoId, {
          type: "session_status",
          payload: { repoId, status },
        });
      },
    );

    this.logger.info({ component: "app_server_bridge" }, "bridge_ready");
  }

  private async handleTurnNotification(
    repoId: string,
    message: RpcNotification,
  ): Promise<void> {
    const turnId = this.turnState.getTurnIdFromNotification(message);
    if (!turnId) return;
    if (message.method === "turn/completed") {
      const status = this.turnState.get(repoId, turnId);
      if (status === "interrupted") return;
    }
    const repoName = await this.resolveRepoName(repoId);
    const title = `CodexDock: ${repoName}`;
    const agentMessage =
      this.turnState.getLastAgentMessage(repoId, turnId) ?? "";
    const body =
      agentMessage.trim().length > 0
        ? this.truncateMessage(agentMessage)
        : this.defaultTurnBody(message.method);
    await this.notify({ title, message: body });
  }

  private async handleApprovalNotification(
    repoId: string,
    message: RpcRequest,
  ): Promise<void> {
    const repoName = await this.resolveRepoName(repoId);
    const title = `CodexDock: ${repoName}`;
    const body = this.describeApproval(message.method);
    await this.notify({ title, message: body });
  }

  private async resolveRepoName(repoId: string): Promise<string> {
    try {
      const repo = await this.registry.get(repoId);
      return repo?.name ?? repoId;
    } catch (error) {
      this.logger.warn(
        { component: "app_server_bridge", repoId, error },
        "repo_lookup_failed",
      );
      return repoId;
    }
  }

  private describeApproval(method: string): string {
    if (method.includes("commandExecution")) {
      return "Command approval required.";
    }
    if (method.includes("fileChange")) {
      return "File change approval required.";
    }
    return "Approval required.";
  }

  private defaultTurnBody(method: string): string {
    if (method === "turn/failed" || method === "turn/error") {
      return "Turn failed.";
    }
    return "Turn completed.";
  }

  private truncateMessage(value: string): string {
    const trimmed = value.replace(/\\s+/g, " ").trim();
    if (trimmed.length <= 240) return trimmed;
    return `${trimmed.slice(0, 237)}...`;
  }
}
