import type { Server } from "node:http";
import type { Logger } from "pino";
import { WebSocket, WebSocketServer } from "ws";
import type { AppServerManager } from "./appServerManager.js";
import { getRecord, getString, isRecord } from "./guards.js";
import type { RepoRegistry } from "./repoRegistry.js";
import type { JsonValue } from "./types.js";

type Connection = {
  id: string;
  socket: WebSocket;
  subscribed: Set<string>;
};

export class WebSocketGateway {
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, Connection>();
  private logger: Logger;
  private registry: RepoRegistry;
  private manager: AppServerManager;
  private counter = 1;

  constructor(options: {
    logger: Logger;
    registry: RepoRegistry;
    manager: AppServerManager;
  }) {
    this.logger = options.logger;
    this.registry = options.registry;
    this.manager = options.manager;
  }

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
  }

  broadcastToRepo(repoId: string, message: unknown): void {
    for (const conn of this.connections.values()) {
      if (conn.subscribed.has(repoId)) {
        this.send(conn.socket, message);
      }
    }
  }

  private handleConnection(socket: WebSocket): void {
    const id = `conn_${this.counter++}`;
    const conn: Connection = { id, socket, subscribed: new Set() };
    this.connections.set(id, conn);
    this.logger.info({ component: "ws", connectionId: id }, "connection_open");

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString());
        void this.handleMessage(conn, payload);
      } catch (error) {
        this.logger.warn(
          { component: "ws", connectionId: id },
          "invalid_message",
        );
      }
    });

    socket.on("close", () => {
      this.connections.delete(id);
      this.logger.info(
        { component: "ws", connectionId: id },
        "connection_closed",
      );
    });
  }

  private async handleMessage(
    conn: Connection,
    payload: unknown,
  ): Promise<void> {
    if (!isRecord(payload)) {
      this.logger.warn(
        { component: "ws", connectionId: conn.id },
        "invalid_message",
      );
      return;
    }
    const messageType = getString(payload, "type");
    switch (messageType) {
      case "subscribe":
        await this.handleSubscribe(conn, payload);
        break;
      case "unsubscribe":
        this.handleUnsubscribe(conn, payload);
        break;
      case "app_server_response":
        this.handleAppServerResponse(payload);
        break;
      default:
        this.logger.warn(
          { component: "ws", connectionId: conn.id },
          "unknown_type",
        );
        break;
    }
  }

  private async handleSubscribe(
    conn: Connection,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const payloadRecord = getRecord(payload, "payload");
    const repoId = payloadRecord
      ? getString(payloadRecord, "repoId")
      : undefined;
    const requestId = getString(payload, "requestId");
    if (!repoId || !requestId) {
      this.send(conn.socket, {
        type: "subscribe_error",
        requestId: requestId ?? "",
        payload: {
          repoId: repoId ?? "",
          error: { code: "invalid_request", message: "repoId missing" },
        },
      });
      return;
    }
    const repo = await this.registry.get(repoId);
    if (!repo) {
      this.send(conn.socket, {
        type: "subscribe_error",
        requestId,
        payload: {
          repoId,
          error: { code: "repo_not_found", message: "repo not found" },
        },
      });
      return;
    }
    conn.subscribed.add(repoId);
    this.send(conn.socket, {
      type: "subscribe_ack",
      requestId,
      payload: { repoId },
    });
    this.send(conn.socket, {
      type: "session_status",
      payload: { repoId, status: this.manager.getStatus(repoId) },
    });
  }

  private handleUnsubscribe(conn: Connection, payload: unknown): void {
    const payloadRecord = isRecord(payload)
      ? getRecord(payload, "payload")
      : undefined;
    const repoId = payloadRecord
      ? getString(payloadRecord, "repoId")
      : undefined;
    const requestId = isRecord(payload)
      ? getString(payload, "requestId")
      : undefined;
    if (repoId) {
      conn.subscribed.delete(repoId);
    }
    this.send(conn.socket, {
      type: "unsubscribe_ack",
      requestId: requestId ?? "",
      payload: { repoId: repoId ?? "" },
    });
  }

  private handleAppServerResponse(payload: unknown): void {
    if (!isRecord(payload)) return;
    const payloadRecord = getRecord(payload, "payload");
    const repoId = payloadRecord
      ? getString(payloadRecord, "repoId")
      : undefined;
    const message = payloadRecord ? payloadRecord.message : undefined;
    if (!repoId || !isRecord(message)) {
      return;
    }
    const idValue = message.id;
    if (typeof idValue !== "string" && typeof idValue !== "number") {
      return;
    }
    this.manager.sendResponse(repoId, {
      id: idValue,
      result: message.result as JsonValue | undefined,
      error: message.error as JsonValue | undefined,
    });
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
