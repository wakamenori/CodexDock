import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import type { Logger } from "pino";
import { isRecord } from "./guards.js";
import type {
  JsonValue,
  RpcNotification,
  RpcRequest,
  RpcResponse,
  SessionStatus,
} from "./types.js";
import { sleep } from "./utils.js";

export type AppServerSessionOptions = {
  repoId: string;
  logger: Logger;
  clientInfo: { name: string; version: string };
};

export type AppServerSessionLike = EventEmitter & {
  repoId: string;
  status: SessionStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  request(method: string, params?: JsonValue): Promise<unknown>;
  notify(method: string, params?: JsonValue): void;
  sendResponse(message: RpcResponse): void;
  waitForConnected(timeoutMs?: number): Promise<void>;
};

export class AppServerSession extends EventEmitter {
  repoId: string;
  status: SessionStatus = "stopped";
  private logger: Logger;
  private clientInfo: { name: string; version: string };
  private process: ReturnType<typeof spawn> | null = null;
  private nextId = 1;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout?: NodeJS.Timeout;
    }
  >();

  constructor(options: AppServerSessionOptions) {
    super();
    this.repoId = options.repoId;
    this.logger = options.logger;
    this.clientInfo = options.clientInfo;
  }

  async start(): Promise<void> {
    if (this.status === "connected" || this.status === "starting") {
      return;
    }
    this.setStatus("starting");
    this.process = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.on("exit", (code, signal) => {
      this.logger.info(
        { component: "app_server_session", repoId: this.repoId, code, signal },
        "process_exit",
      );
      const nextStatus = signal || code === 0 ? "stopped" : "error";
      this.setStatus(nextStatus);
      this.process = null;
      this.flushPending(new Error("App server exited"));
    });

    this.process.on("error", (error) => {
      this.logger.error(
        { component: "app_server_session", repoId: this.repoId, error },
        "process_error",
      );
      this.setStatus("error");
      this.process = null;
      this.flushPending(error);
    });

    if (this.process.stderr) {
      this.process.stderr.on("data", (chunk) => {
        this.logger.warn(
          {
            component: "app_server_session",
            repoId: this.repoId,
            stderr: chunk.toString(),
          },
          "stderr",
        );
      });
    }

    if (this.process.stdout) {
      const rl = readline.createInterface({ input: this.process.stdout });
      rl.on("line", (line) => this.handleLine(line));
    }

    await this.initialize();
    this.setStatus("connected");
  }

  async stop(): Promise<void> {
    if (!this.process) {
      this.setStatus("stopped");
      return;
    }
    this.process.kill("SIGTERM");
    await sleep(200);
    if (this.status !== "stopped") {
      this.process.kill("SIGKILL");
    }
  }

  async request(method: string, params?: JsonValue): Promise<unknown> {
    const id = this.nextId++;
    const payload: RpcRequest = {
      id,
      method,
      params: params === undefined ? {} : params,
    };
    this.send(payload);
    const key = String(id);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`RPC timeout: ${method}`));
      }, 60000);
      this.pending.set(key, { resolve, reject, timeout });
    });
  }

  notify(method: string, params?: JsonValue): void {
    const payload: RpcNotification = {
      method,
      params: params === undefined ? {} : params,
    };
    this.send(payload);
  }

  sendResponse(message: RpcResponse): void {
    this.send(message);
  }

  async waitForConnected(timeoutMs = 15000): Promise<void> {
    if (this.status === "connected") return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Session connection timeout"));
      }, timeoutMs);

      const onStatus = (status: SessionStatus) => {
        if (status === "connected") {
          cleanup();
          resolve();
        }
        if (status === "error" || status === "stopped") {
          cleanup();
          reject(new Error("Session failed"));
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("status", onStatus);
      };

      this.on("status", onStatus);
    });
  }

  private async initialize(): Promise<void> {
    try {
      await this.request("initialize", { clientInfo: this.clientInfo });
      this.notify("initialized", {});
    } catch (error) {
      this.setStatus("error");
      this.logger.error(
        { component: "app_server_session", repoId: this.repoId, error },
        "initialize_failed",
      );
      throw error;
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.logger.warn(
        { component: "app_server_session", repoId: this.repoId, line },
        "invalid_json",
      );
      return;
    }

    if (!isRecord(message)) {
      this.logger.warn(
        { component: "app_server_session", repoId: this.repoId, message },
        "unknown_message",
      );
      return;
    }

    const idValue = message.id;
    const methodValue = message.method;
    const hasId = typeof idValue === "string" || typeof idValue === "number";
    const hasMethod = typeof methodValue === "string";
    const params = message.params as JsonValue | undefined;

    if (hasId && hasMethod) {
      this.emit("request", {
        id: idValue,
        method: methodValue,
        params,
      } satisfies RpcRequest);
      return;
    }

    if (hasId) {
      const pending = this.pending.get(String(idValue));
      if (!pending) {
        this.logger.warn(
          {
            component: "app_server_session",
            repoId: this.repoId,
            rpcId: idValue,
          },
          "unexpected_response",
        );
        return;
      }
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      this.pending.delete(String(idValue));
      const errorValue = message.error as JsonValue | undefined;
      if (errorValue) {
        const errorMessage =
          typeof errorValue === "string"
            ? errorValue
            : isRecord(errorValue)
              ? ((errorValue.message as string | undefined) ?? "RPC error")
              : "RPC error";
        pending.reject(new Error(errorMessage));
      } else {
        pending.resolve(message.result as JsonValue | undefined);
      }
      return;
    }

    if (hasMethod) {
      this.emit("notification", {
        method: methodValue,
        params,
      } satisfies RpcNotification);
      return;
    }

    this.logger.warn(
      { component: "app_server_session", repoId: this.repoId, message },
      "unknown_message",
    );
  }

  private send(payload: RpcRequest | RpcNotification | RpcResponse): void {
    if (!this.process?.stdin) {
      throw new Error("App server process not started");
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private flushPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setStatus(status: SessionStatus): void {
    this.status = status;
    this.emit("status", status);
  }
}
