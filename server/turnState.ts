import { getIdString, getRecord, getString, isRecord } from "./guards.js";
import type { RpcNotification } from "./types.js";

export type TurnStatus = "running" | "completed" | "failed" | "interrupted";
type AgentMessageState = { itemId?: string; text: string };

const extractTurnId = (params: unknown): string | undefined => {
  const record = isRecord(params) ? params : undefined;
  const turnRecord = getRecord(record, "turn");
  const itemRecord = getRecord(record, "item");
  const itemTurnRecord = itemRecord ? getRecord(itemRecord, "turn") : undefined;
  return (
    getIdString(turnRecord?.id) ??
    getIdString(record?.turnId) ??
    getIdString(record?.turn_id) ??
    getIdString(record?.id) ??
    getIdString(turnRecord?.turnId) ??
    getIdString(turnRecord?.turn_id) ??
    getIdString(itemRecord?.turnId) ??
    getIdString(itemRecord?.turn_id) ??
    getIdString(itemTurnRecord?.id)
  );
};

const extractItemId = (params: unknown): string | undefined => {
  const record = isRecord(params) ? params : undefined;
  const itemRecord = getRecord(record, "item");
  return (
    getIdString(record?.itemId) ??
    getIdString(record?.item_id) ??
    getIdString(itemRecord?.id)
  );
};

const extractDeltaText = (params: unknown): string => {
  const record = isRecord(params) ? params : undefined;
  const deltaValue = record?.delta;
  if (typeof deltaValue === "string") return deltaValue;
  const deltaRecord = isRecord(deltaValue) ? deltaValue : undefined;
  const candidate =
    deltaRecord?.text ??
    deltaRecord?.content ??
    record?.text ??
    record?.message;
  return typeof candidate === "string" ? candidate : "";
};

const isAgentMessageItem = (item: Record<string, unknown> | undefined) => {
  const itemType = typeof item?.type === "string" ? item?.type : undefined;
  return itemType === "agentMessage" || itemType === "assistantMessage";
};

export class TurnStateStore {
  private turns = new Map<string, Map<string, TurnStatus>>();
  private agentMessages = new Map<string, Map<string, AgentMessageState>>();

  updateFromNotification(repoId: string, message: RpcNotification): void {
    const method = message.method;
    const params = message.params;
    const paramsRecord = isRecord(params) ? params : undefined;
    const turnRecord = getRecord(paramsRecord, "turn");
    const turnId = extractTurnId(paramsRecord);
    if (!turnId) return;

    if (method === "turn/started") {
      this.set(repoId, String(turnId), "running");
    }
    if (method === "turn/completed") {
      const statusValue =
        getString(paramsRecord, "status") ?? getString(turnRecord, "status");
      const status =
        statusValue === "interrupted" ? "interrupted" : "completed";
      this.set(repoId, String(turnId), status);
    }
    if (method === "turn/failed" || method === "turn/error") {
      this.set(repoId, String(turnId), "failed");
    }

    if (
      method === "item/agentMessage/delta" ||
      method === "item/assistantMessage/delta"
    ) {
      const deltaText = extractDeltaText(paramsRecord);
      if (!deltaText) return;
      this.appendAgentMessage(repoId, String(turnId), deltaText, {
        itemId: extractItemId(paramsRecord),
      });
    }

    if (method === "item/started" || method === "item/completed") {
      const itemRecord = getRecord(paramsRecord, "item");
      if (!isAgentMessageItem(itemRecord)) return;
      const text = typeof itemRecord?.text === "string" ? itemRecord.text : "";
      if (!text) return;
      this.setAgentMessage(repoId, String(turnId), text, {
        itemId: extractItemId(paramsRecord),
      });
    }
  }

  get(repoId: string, turnId: string): TurnStatus | undefined {
    return this.turns.get(repoId)?.get(turnId);
  }

  getTurnIdFromNotification(message: RpcNotification): string | undefined {
    return extractTurnId(message.params);
  }

  getLastAgentMessage(repoId: string, turnId: string): string | undefined {
    return this.agentMessages.get(repoId)?.get(turnId)?.text;
  }

  private set(repoId: string, turnId: string, status: TurnStatus): void {
    if (!this.turns.has(repoId)) {
      this.turns.set(repoId, new Map());
    }
    this.turns.get(repoId)?.set(turnId, status);
  }

  private setAgentMessage(
    repoId: string,
    turnId: string,
    text: string,
    options: { itemId?: string },
  ): void {
    const byRepo = this.agentMessages.get(repoId) ?? new Map();
    byRepo.set(turnId, { itemId: options.itemId, text });
    this.agentMessages.set(repoId, byRepo);
  }

  private appendAgentMessage(
    repoId: string,
    turnId: string,
    delta: string,
    options: { itemId?: string },
  ): void {
    const byRepo = this.agentMessages.get(repoId) ?? new Map();
    const existing = byRepo.get(turnId);
    const shouldAppend =
      existing && (!options.itemId || options.itemId === existing.itemId);
    if (shouldAppend) {
      byRepo.set(turnId, {
        itemId: existing.itemId,
        text: `${existing.text}${delta}`,
      });
    } else {
      byRepo.set(turnId, { itemId: options.itemId, text: delta });
    }
    this.agentMessages.set(repoId, byRepo);
  }
}
