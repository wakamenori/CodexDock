import type { ChatMessage } from "../types";

export const createRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const formatTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const asRecord = (
  value: unknown,
): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

export const getIdString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
};

export const getRecordId = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  if (!record) return undefined;
  return getIdString(record[key]);
};

export const normalizeRootPath = (value?: string): string => {
  if (!value) return "";
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
};

export const extractThreadId = (params: unknown) => {
  const record = asRecord(params);
  const threadRecord = asRecord(record?.thread);
  const itemRecord = asRecord(record?.item);
  const turnRecord = asRecord(record?.turn);
  const itemThreadRecord = asRecord(itemRecord?.thread);
  const turnThreadRecord = asRecord(turnRecord?.thread);
  return (
    getRecordId(record, "threadId") ??
    getRecordId(record, "thread_id") ??
    getRecordId(threadRecord, "id") ??
    getRecordId(threadRecord, "threadId") ??
    getRecordId(threadRecord, "thread_id") ??
    getRecordId(itemRecord, "threadId") ??
    getRecordId(itemRecord, "thread_id") ??
    getRecordId(itemThreadRecord, "id") ??
    getRecordId(turnRecord, "threadId") ??
    getRecordId(turnRecord, "thread_id") ??
    getRecordId(turnThreadRecord, "id")
  );
};

export const extractTurnId = (params: unknown) => {
  const record = asRecord(params);
  const turnRecord = asRecord(record?.turn);
  return (
    getRecordId(turnRecord, "id") ??
    getRecordId(record, "turnId") ??
    getRecordId(record, "turn_id") ??
    getRecordId(record, "id") ??
    getRecordId(turnRecord, "turnId") ??
    getRecordId(turnRecord, "turn_id")
  );
};

export const extractDeltaText = (params: unknown) => {
  const record = asRecord(params);
  const directDelta = record?.delta;
  if (typeof directDelta === "string") return directDelta;
  const deltaRecord = asRecord(record?.delta);
  const candidate =
    deltaRecord?.text ??
    deltaRecord?.content ??
    record?.text ??
    record?.message;
  return typeof candidate === "string" ? candidate : "";
};

export const extractItemRecord = (params: unknown) => {
  const record = asRecord(params);
  return asRecord(record?.item);
};

export const extractItemId = (params: unknown, fallback: string) => {
  const record = asRecord(params);
  const itemRecord = asRecord(record?.item);
  return (
    getRecordId(record, "itemId") ??
    getRecordId(record, "item_id") ??
    getRecordId(itemRecord, "id") ??
    fallback
  );
};

const extractResumeItems = (result: unknown): Record<string, unknown>[] => {
  const record = asRecord(result);
  const threadRecord = asRecord(record?.thread);
  const turns = Array.isArray(threadRecord?.turns) ? threadRecord?.turns : [];
  const items: Record<string, unknown>[] = [];
  for (const turn of turns) {
    const turnRecord = asRecord(turn);
    const turnItems = Array.isArray(turnRecord?.items) ? turnRecord?.items : [];
    for (const item of turnItems) {
      const itemRecord = asRecord(item);
      if (itemRecord) {
        items.push(itemRecord);
      }
    }
  }
  return items;
};

export const buildMessagesFromResume = (
  threadId: string,
  result: unknown,
): ChatMessage[] => {
  const resultRecord = asRecord(result);
  const resumePayload = resultRecord?.resume ?? resultRecord;
  const items = extractResumeItems(resumePayload);
  const baseTime = Date.now();
  const messages: ChatMessage[] = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    const itemType = item.type;
    const itemId = getRecordId(item, "id") ?? `${threadId}-${idx}`;
    if (itemType === "userMessage") {
      const text = extractUserMessageText(item);
      if (text) {
        messages.push({
          id: itemId,
          itemId,
          role: "user",
          text,
          createdAt: baseTime + idx,
        });
      }
      continue;
    }
    if (itemType === "agentMessage" || itemType === "assistantMessage") {
      const text = extractAgentMessageText(item);
      if (text) {
        messages.push({
          id: itemId,
          itemId,
          role: "agent",
          text,
          createdAt: baseTime + idx,
        });
      }
    }
  }
  return messages;
};

export const extractUserMessageText = (item: Record<string, unknown>): string => {
  const content = item.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const entry of content) {
      const entryRecord = asRecord(entry);
      if (!entryRecord) continue;
      const text = entryRecord.text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
    if (parts.length > 0) return parts.join("\n");
    if (content.length > 0) return "[non-text input]";
  }
  const text = item.text;
  return typeof text === "string" ? text : "";
};

export const extractAgentMessageText = (item: Record<string, unknown>): string => {
  const text = item.text;
  return typeof text === "string" ? text : "";
};

export const extractDiffText = (params: unknown) => {
  const record = asRecord(params);
  const diffRecord = asRecord(record?.diff);
  const candidate =
    diffRecord?.text ?? diffRecord?.patch ?? record?.diff ?? record?.patch;
  if (typeof candidate === "string") {
    return candidate;
  }
  return JSON.stringify(params ?? {}, null, 2);
};
