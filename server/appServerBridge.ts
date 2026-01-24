import type { Logger } from "pino";
import type { AppServerManager } from "./appServerManager.js";
import type { ThreadListRefresher } from "./threadListRefresher.js";
import type { TurnStateStore } from "./turnState.js";
import type { RpcNotification, RpcRequest } from "./types.js";
import type { WebSocketGateway } from "./websocketGateway.js";

export class AppServerBridge {
  private manager: AppServerManager;
  private gateway: WebSocketGateway;
  private turnState: TurnStateStore;
  private refresher: ThreadListRefresher;
  private logger: Logger;

  constructor(options: {
    manager: AppServerManager;
    gateway: WebSocketGateway;
    turnState: TurnStateStore;
    refresher: ThreadListRefresher;
    logger: Logger;
  }) {
    this.manager = options.manager;
    this.gateway = options.gateway;
    this.turnState = options.turnState;
    this.refresher = options.refresher;
    this.logger = options.logger;
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
        this.gateway.broadcastToRepo(repoId, {
          type: "app_server_notification",
          payload: { repoId, message },
        });
      },
    );

    this.manager.on(
      "session_request",
      ({ repoId, message }: { repoId: string; message: RpcRequest }) => {
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
}
