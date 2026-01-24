import { EventEmitter } from "node:events";
import type {
  JsonValue,
  RpcNotification,
  RpcRequest,
  RpcResponse,
  SessionStatus,
} from "../types.js";

export class FakeAppServerSession extends EventEmitter {
  repoId: string;
  status: SessionStatus = "stopped";
  private handlers = new Map<string, (params?: JsonValue) => JsonValue>();

  constructor(repoId: string) {
    super();
    this.repoId = repoId;
  }

  async start(): Promise<void> {
    this.status = "connected";
    this.emit("status", this.status);
  }

  async stop(): Promise<void> {
    this.status = "stopped";
    this.emit("status", this.status);
  }

  async request(method: string, params?: JsonValue): Promise<JsonValue> {
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new Error(`Unhandled request: ${method}`);
    }
    return handler(params);
  }

  notify(_method: string, _params?: JsonValue): void {
    return;
  }

  sendResponse(message: RpcResponse): void {
    this.emit("response", message);
  }

  waitForConnected(): Promise<void> {
    return Promise.resolve();
  }

  onRequest(method: string, handler: (params?: JsonValue) => JsonValue): void {
    this.handlers.set(method, handler);
  }

  emitNotification(method: string, params?: JsonValue): void {
    const payload: RpcNotification = { method, params };
    this.emit("notification", payload);
  }

  emitServerRequest(
    id: number | string,
    method: string,
    params?: JsonValue,
  ): void {
    const payload: RpcRequest = { id, method, params };
    this.emit("request", payload);
  }
}
