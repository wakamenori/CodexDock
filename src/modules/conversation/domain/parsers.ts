import { normalizeRootPath as normalizeRootPathShared } from "../../../shared/paths";
import { asRecord, getRecordId } from "../../../shared/records";
import type { ChatMessage, FileChangeEntry } from "../../../types";

const REASONING_SUMMARY_LIMIT = 4000;
const REASONING_CONTENT_LIMIT = 20000;
const REASONING_PART_SEPARATOR = "\n\n";

const truncateText = (value: string, limit: number) =>
  value.length > limit ? value.slice(0, limit) : value;

const extractTextPartList = (value: unknown): string[] => {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  const parts: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry) parts.push(entry);
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const text = record.text ?? record.content ?? record.summary;
    if (typeof text === "string" && text) {
      parts.push(text);
    }
  }
  return parts;
};

const joinTextParts = (parts: string[], separator = REASONING_PART_SEPARATOR) =>
  parts.filter((part) => part.length > 0).join(separator);

const clampReasoningParts = (parts: string[], limit: number): string[] => {
  const next: string[] = [];
  let remaining = limit;
  let hasEmitted = false;
  for (const part of parts) {
    if (!part) {
      next.push("");
      continue;
    }
    if (hasEmitted) {
      if (remaining <= REASONING_PART_SEPARATOR.length) break;
      remaining -= REASONING_PART_SEPARATOR.length;
    }
    if (part.length <= remaining) {
      next.push(part);
      remaining -= part.length;
    } else {
      next.push(part.slice(0, remaining));
      remaining = 0;
      break;
    }
    hasEmitted = true;
  }
  return next;
};

export const normalizeReasoningSummary = (value: string) =>
  truncateText(value, REASONING_SUMMARY_LIMIT);

export const normalizeReasoningContent = (value: string) =>
  truncateText(value, REASONING_CONTENT_LIMIT);

export const normalizeReasoningSummaryParts = (parts: string[]) =>
  clampReasoningParts(parts, REASONING_SUMMARY_LIMIT);

export const normalizeReasoningContentParts = (parts: string[]) =>
  clampReasoningParts(parts, REASONING_CONTENT_LIMIT);

export const appendReasoningSummary = (current: string, delta: string) =>
  normalizeReasoningSummary(`${current}${delta}`);

export const appendReasoningContent = (current: string, delta: string) =>
  normalizeReasoningContent(`${current}${delta}`);

export const joinReasoningParts = (parts: string[]) =>
  joinTextParts(parts, REASONING_PART_SEPARATOR);

export const parseReasoningItemParts = (item: Record<string, unknown>) => {
  const summaryParts = normalizeReasoningSummaryParts(
    extractTextPartList(item.summary),
  );
  const contentParts = normalizeReasoningContentParts(
    extractTextPartList(item.content),
  );
  return {
    summaryParts,
    contentParts,
    summaryText: normalizeReasoningSummary(joinReasoningParts(summaryParts)),
    contentText: normalizeReasoningContent(joinReasoningParts(contentParts)),
  };
};

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

const parseNumericIndex = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

export const parseReasoningSummaryIndex = (
  params: unknown,
): number | undefined => {
  const record = asRecord(params);
  const deltaRecord = asRecord(record?.delta);
  return (
    parseNumericIndex(record?.summaryIndex) ??
    parseNumericIndex(record?.summary_index) ??
    parseNumericIndex(deltaRecord?.summaryIndex) ??
    parseNumericIndex(deltaRecord?.summary_index)
  );
};

export const parseReasoningContentIndex = (
  params: unknown,
): number | undefined => {
  const record = asRecord(params);
  const deltaRecord = asRecord(record?.delta);
  return (
    parseNumericIndex(record?.contentIndex) ??
    parseNumericIndex(record?.content_index) ??
    parseNumericIndex(deltaRecord?.contentIndex) ??
    parseNumericIndex(deltaRecord?.content_index)
  );
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
      if (!itemRecord) continue;
      const nested = asRecord(itemRecord.item);
      if (nested) {
        const merged = { ...nested } as Record<string, unknown>;
        if (typeof merged.status !== "string") {
          merged.status =
            typeof itemRecord.status === "string"
              ? itemRecord.status
              : merged.status;
        }
        if (merged.turnId === undefined && itemRecord.turnId !== undefined) {
          merged.turnId = itemRecord.turnId;
        }
        items.push(merged);
        continue;
      }
      if (typeof itemRecord.type === "string") {
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
      const { summaryParts, contentParts, summaryText, contentText } =
        parseReasoningItemParts(item);
      messages.push({
        id: itemId,
        itemId,
        role: "reasoning",
        text: "",
        summary: summaryText,
        content: contentText,
        summaryParts,
        contentParts,
        createdAt: baseTime + idx,
      });
    }
  }
  return messages;
};

export const deriveReviewingFromResume = (result: unknown): boolean => {
  const resultRecord = asRecord(result);
  const resumePayload = resultRecord?.resume ?? resultRecord;
  const items = extractResumeItems(resumePayload);
  let reviewing = false;
  for (const item of items) {
    const itemType = item.type;
    if (itemType === "enteredReviewMode") {
      reviewing = true;
    }
    if (itemType === "exitedReviewMode") {
      reviewing = false;
    }
  }
  return reviewing;
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
