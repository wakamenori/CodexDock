import { getIdString, getRecord, getString, isRecord } from "./guards.js";
import type { RpcNotification } from "./types.js";

export type TurnStatus = "running" | "completed" | "failed" | "interrupted";

export class TurnStateStore {
  private turns = new Map<string, Map<string, TurnStatus>>();

  updateFromNotification(repoId: string, message: RpcNotification): void {
    const method = message.method;
    const params = message.params;
    const paramsRecord = isRecord(params) ? params : undefined;
    const turnRecord = getRecord(paramsRecord, "turn");
    const turnId =
      getIdString(turnRecord?.id) ??
      getIdString(paramsRecord?.turnId) ??
      getIdString(turnRecord?.turnId);
    if (!turnId) return;

    if (method === "turn/started") {
      this.set(repoId, String(turnId), "running");
    }
    if (method === "turn/completed") {
      const statusValue = getString(paramsRecord, "status");
      const status =
        statusValue === "interrupted" ? "interrupted" : "completed";
      this.set(repoId, String(turnId), status);
    }
    if (method === "turn/failed") {
      this.set(repoId, String(turnId), "failed");
    }
  }

  get(repoId: string, turnId: string): TurnStatus | undefined {
    return this.turns.get(repoId)?.get(turnId);
  }

  private set(repoId: string, turnId: string, status: TurnStatus): void {
    if (!this.turns.has(repoId)) {
      this.turns.set(repoId, new Map());
    }
    this.turns.get(repoId)?.set(turnId, status);
  }
}
