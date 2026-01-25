import { normalizeRootPath as normalizeRootPathShared } from "../../../shared/paths";
import { asRecord, getIdString, getRecordId } from "../../../shared/records";
import type { ChatMessage, FileChangeEntry } from "../../../types";

const REASONING_SUMMARY_LIMIT = 4000;
const REASONING_CONTENT_LIMIT = 20000;

const truncateText = (value: string, limit: number) =>
  value.length > limit ? value.slice(0, limit) : value;

export const normalizeReasoningSummary = (value: string) =>
  truncateText(value, REASONING_SUMMARY_LIMIT);

export const normalizeReasoningContent = (value: string) =>
  truncateText(value, REASONING_CONTENT_LIMIT);

export const appendReasoningSummary = (current: string, delta: string) =>
  normalizeReasoningSummary(`${current}${delta}`);

export const appendReasoningContent = (current: string, delta: string) =>
  normalizeReasoningContent(`${current}${delta}`);

export const normalizeRootPath = (value?: string) =>
  normalizeRootPathShared(value);

export const createRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const parseThreadId = (params: unknown): string | undefined => {
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

export const parseTurnId = (params: unknown): string | undefined => {
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

export const parseDeltaText = (params: unknown) => {
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

export const parseItemRecord = (params: unknown) => {
  const record = asRecord(params);
  return asRecord(record?.item);
};

export const parseItemId = (params: unknown, fallback: string) => {
  const record = asRecord(params);
  const itemRecord = asRecord(record?.item);
  return (
    getRecordId(record, "itemId") ??
    getRecordId(record, "item_id") ??
    getRecordId(itemRecord, "id") ??
    fallback
  );
};

export const parseUserMessageText = (item: Record<string, unknown>): string => {
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

export const parseAgentMessageText = (
  item: Record<string, unknown>,
): string => {
  const text = item.text;
  return typeof text === "string" ? text : "";
};

export const parseDiffText = (params: unknown) => {
  const record = asRecord(params);
  const diffRecord = asRecord(record?.diff);
  const candidate =
    diffRecord?.text ?? diffRecord?.patch ?? record?.diff ?? record?.patch;
  if (typeof candidate === "string") {
    return candidate;
  }
  return JSON.stringify(params ?? {}, null, 2);
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
      const text = parseUserMessageText(item);
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
      const text = parseAgentMessageText(item);
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
    if (itemType === "reasoning") {
      const summary = typeof item.summary === "string" ? item.summary : "";
      const content = typeof item.content === "string" ? item.content : "";
      messages.push({
        id: itemId,
        itemId,
        role: "reasoning",
        text: "",
        summary: normalizeReasoningSummary(summary),
        content: normalizeReasoningContent(content),
        createdAt: baseTime + idx,
      });
    }
  }
  return messages;
};

export const parseFileChangeEntries = (
  item: Record<string, unknown>,
): FileChangeEntry["changes"] => {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const result: FileChangeEntry["changes"] = [];
  for (const change of changes) {
    const record = asRecord(change);
    if (!record) continue;
    const path =
      (typeof record.path === "string" && record.path) ||
      (typeof record.filePath === "string" && record.filePath) ||
      (typeof record.file === "string" && record.file) ||
      "";
    const kind = typeof record.kind === "string" ? record.kind : undefined;
    const diff =
      typeof record.diff === "string"
        ? record.diff
        : typeof record.patch === "string"
          ? record.patch
          : undefined;
    result.push({ path, kind, diff });
  }
  return result;
};

export const parseFileChangeStatus = (item: Record<string, unknown>) => {
  const status = item.status;
  return typeof status === "string" ? status : undefined;
};

export const parseFileChangeTurnId = (
  params: unknown,
  item: Record<string, unknown>,
) => {
  const paramsTurnId = parseTurnId(params);
  if (paramsTurnId) return paramsTurnId;
  const turnRecord = asRecord(item.turn);
  return (
    getRecordId(item, "turnId") ??
    getRecordId(item, "turn_id") ??
    getRecordId(turnRecord, "id") ??
    getRecordId(turnRecord, "turnId") ??
    getRecordId(turnRecord, "turn_id")
  );
};
