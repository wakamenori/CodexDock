import {
  buildUploadImageUrl,
  extractFileName,
  normalizeRootPath as normalizeRootPathShared,
} from "../../../shared/paths";
import { asRecord, getRecordId } from "../../../shared/records";
import type {
  ChatMessage,
  FileChangeEntry,
  JsonValue,
  ToolItemType,
  ToolTimelineItem,
  UserMessageImage,
} from "../../../types";

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

export const parseUserMessageContent = (
  item: Record<string, unknown>,
): { text: string; images: UserMessageImage[] } => {
  const content = item.content;
  const parts: string[] = [];
  const images: UserMessageImage[] = [];

  if (Array.isArray(content)) {
    for (const entry of content) {
      const entryRecord = asRecord(entry);
      if (!entryRecord) continue;
      const entryType =
        typeof entryRecord.type === "string"
          ? entryRecord.type
          : typeof entryRecord.kind === "string"
            ? entryRecord.kind
            : undefined;
      if (entryType === "text") {
        const text = entryRecord.text;
        if (typeof text === "string") {
          parts.push(text);
        }
        continue;
      }
      if (entryType === "image") {
        const url = entryRecord.url;
        if (typeof url === "string" && url.length > 0) {
          images.push({ kind: "image", url });
        }
        continue;
      }
      if (entryType === "localImage") {
        const path = entryRecord.path;
        if (typeof path === "string" && path.length > 0) {
          images.push({
            kind: "localImage",
            path,
            name:
              typeof entryRecord.name === "string"
                ? entryRecord.name
                : (extractFileName(path) ?? undefined),
            url: buildUploadImageUrl(path) ?? undefined,
          });
        }
        continue;
      }
      const text = entryRecord.text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }

  const textFromContent = parts.length > 0 ? parts.join("\n") : "";
  if (textFromContent) {
    return { text: textFromContent, images };
  }
  const directText = typeof item.text === "string" ? item.text : "";
  return { text: directText, images };
};

export const parseUserMessageText = (item: Record<string, unknown>): string =>
  parseUserMessageContent(item).text;

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
  baseTime: number = Date.now(),
): ChatMessage[] => {
  const resultRecord = asRecord(result);
  const resumePayload = resultRecord?.resume ?? resultRecord;
  const items = extractResumeItems(resumePayload);
  const messages: ChatMessage[] = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    const itemType = item.type;
    const itemId = getRecordId(item, "id") ?? `${threadId}-${idx}`;
    if (itemType === "userMessage") {
      const { text, images } = parseUserMessageContent(item);
      if (text || images.length > 0) {
        messages.push({
          id: itemId,
          itemId,
          role: "user",
          text,
          images: images.length > 0 ? images : undefined,
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

export const buildToolItemsFromResume = (
  threadId: string,
  result: unknown,
  baseTime: number = Date.now(),
): ToolTimelineItem[] => {
  const resultRecord = asRecord(result);
  const resumePayload = resultRecord?.resume ?? resultRecord;
  const items = extractResumeItems(resumePayload);
  const toolItems: ToolTimelineItem[] = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    const toolItem = parseToolItem({ threadId, item }, item, baseTime + idx);
    if (toolItem) {
      toolItems.push(toolItem);
    }
  }
  return toolItems;
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

const isToolItemType = (value: unknown): value is ToolItemType =>
  value === "commandExecution" ||
  value === "fileChange" ||
  value === "mcpToolCall" ||
  value === "collabToolCall" ||
  value === "collabAgentToolCall" ||
  value === "webSearch" ||
  value === "imageView";

const getStringValue = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const getNumberValue = (
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined => {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

const getArrayValue = (
  record: Record<string, unknown> | undefined,
  key: string,
): unknown[] | undefined => {
  if (!record) return undefined;
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
};

const asJsonValue = (value: unknown): JsonValue | undefined =>
  value as JsonValue | undefined;

const buildToolBase = (
  params: unknown,
  item: Record<string, unknown>,
  itemId: string,
  createdAt: number,
): ToolTimelineItem => {
  const itemType = item.type;
  const status = typeof item.status === "string" ? item.status : undefined;
  const threadId = parseThreadId(params);
  const turnId =
    itemType === "fileChange"
      ? parseFileChangeTurnId(params, item)
      : parseTurnId(params);
  return {
    itemId,
    threadId,
    turnId,
    type: itemType as ToolItemType,
    status,
    createdAt,
    updatedAt: createdAt,
  };
};

export const parseToolItem = (
  params: unknown,
  item: Record<string, unknown>,
  createdAt: number,
): ToolTimelineItem | null => {
  const itemType = item.type;
  if (!isToolItemType(itemType)) return null;
  const itemId = parseItemId(params, `${itemType}-${createdAt}`);
  const base = buildToolBase(params, item, itemId, createdAt);

  if (itemType === "commandExecution") {
    const record = asRecord(item);
    const command = getStringValue(record, "command");
    const cwd = getStringValue(record, "cwd");
    const commandActions =
      getArrayValue(record, "commandActions") ??
      getArrayValue(record, "command_actions");
    const aggregatedOutput =
      getStringValue(record, "aggregatedOutput") ??
      getStringValue(record, "aggregated_output");
    const exitCode =
      getNumberValue(record, "exitCode") ?? getNumberValue(record, "exit_code");
    const durationMs =
      getNumberValue(record, "durationMs") ??
      getNumberValue(record, "duration_ms");
    const input = {
      command,
      cwd,
      commandActions: commandActions ?? [],
    };
    const output = {
      status: base.status,
      aggregatedOutput,
      exitCode,
      durationMs,
    };
    return {
      ...base,
      command,
      cwd,
      commandActions: (commandActions ?? []) as JsonValue[],
      aggregatedOutput: aggregatedOutput ?? null,
      exitCode: exitCode ?? null,
      durationMs: durationMs ?? null,
      input: asJsonValue(input),
      output: asJsonValue(output),
    };
  }

  if (itemType === "fileChange") {
    const changes = parseFileChangeEntries(item);
    const status = parseFileChangeStatus(item);
    const input = { changes };
    const output = { status };
    return {
      ...base,
      status: status ?? base.status,
      changes,
      input: asJsonValue(input),
      output: asJsonValue(output),
    };
  }

  if (itemType === "mcpToolCall") {
    const record = asRecord(item);
    const server = getStringValue(record, "server");
    const tool = getStringValue(record, "tool");
    const argumentsValue = asJsonValue(record?.arguments);
    const result = asJsonValue(record?.result);
    const error = asJsonValue(record?.error);
    const durationMs =
      getNumberValue(record, "durationMs") ??
      getNumberValue(record, "duration_ms");
    const input = { server, tool, arguments: argumentsValue };
    const output = {
      status: base.status,
      result,
      error,
      durationMs,
    };
    return {
      ...base,
      server,
      tool,
      arguments: argumentsValue,
      result,
      durationMs: durationMs ?? null,
      input: asJsonValue(input),
      output: asJsonValue(output),
      error: error ?? undefined,
    };
  }

  if (itemType === "collabToolCall" || itemType === "collabAgentToolCall") {
    const record = asRecord(item);
    const tool = getStringValue(record, "tool");
    const senderThreadId =
      getStringValue(record, "senderThreadId") ??
      getStringValue(record, "sender_thread_id");
    const receiverThreadIds =
      getArrayValue(record, "receiverThreadIds")?.filter(
        (entry) => typeof entry === "string",
      ) ??
      getArrayValue(record, "receiver_thread_ids")?.filter(
        (entry) => typeof entry === "string",
      ) ??
      (getStringValue(record, "receiverThreadId")
        ? [getStringValue(record, "receiverThreadId") as string]
        : []);
    const prompt =
      getStringValue(record, "prompt") ??
      getStringValue(record, "message") ??
      null;
    const agentsStates =
      asJsonValue(record?.agentsStates) ??
      asJsonValue(record?.agents_states) ??
      asJsonValue(record?.agentStatus);
    const input = {
      tool,
      senderThreadId,
      receiverThreadIds,
      prompt,
    };
    const output = {
      status: base.status,
      agentsStates,
    };
    return {
      ...base,
      tool,
      senderThreadId,
      receiverThreadIds,
      prompt,
      agentsStates,
      input: asJsonValue(input),
      output: asJsonValue(output),
    };
  }

  if (itemType === "webSearch") {
    const record = asRecord(item);
    const query = getStringValue(record, "query");
    const input = { query };
    return {
      ...base,
      query,
      input: asJsonValue(input),
    };
  }

  if (itemType === "imageView") {
    const record = asRecord(item);
    const path = getStringValue(record, "path");
    const input = { path };
    return {
      ...base,
      path,
      input: asJsonValue(input),
    };
  }

  return null;
};
