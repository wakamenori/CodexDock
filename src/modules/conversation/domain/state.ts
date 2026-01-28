import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  ToolTimelineItem,
} from "../../../types";
import {
  joinReasoningParts,
  normalizeReasoningContent,
  normalizeReasoningContentParts,
  normalizeReasoningSummary,
  normalizeReasoningSummaryParts,
} from "./parsers";

const now = () => Date.now();

const clone = <T>(value: T[]): T[] => [...value];

const findByItemId = (messages: ChatMessage[], itemId: string) =>
  messages.findIndex((item) => item.itemId === itemId || item.id === itemId);

const preferExistingText = (
  incoming: string | undefined,
  existing: string,
): string => (incoming && incoming.length > 0 ? incoming : existing);

const ensurePartIndex = (parts: string[], index: number): string[] => {
  const next = [...parts];
  while (next.length <= index) {
    next.push("");
  }
  return next;
};

const appendPartDelta = (
  parts: string[],
  index: number,
  deltaText: string,
): string[] => {
  const next = ensurePartIndex(parts, index);
  next[index] = `${next[index] ?? ""}${deltaText}`;
  return next;
};

const buildReasoningText = (
  parts: string[],
  fallback: string | undefined,
  normalizer: (value: string) => string,
): string => {
  const joined = joinReasoningParts(parts);
  return normalizer(joined || fallback || "");
};

const getFallbackParts = (fallbackText: string | undefined): string[] =>
  fallbackText ? [fallbackText] : [];

export const upsertAgentDelta = (
  messages: ChatMessage[],
  itemId: string,
  deltaText: string,
): ChatMessage[] => {
  const list = clone(messages);
  const idx = findByItemId(list, itemId);
  if (idx >= 0) {
    const current = list[idx];
    list[idx] = {
      ...current,
      role: "agent",
      itemId,
      pending: false,
      text: (current.text || "") + deltaText,
    };
    return list;
  }
  list.push({
    id: itemId,
    itemId,
    role: "agent",
    text: deltaText,
    createdAt: now(),
  });
  return list;
};

export const upsertReasoningDelta = (
  messages: ChatMessage[],
  itemId: string,
  deltaText: string,
  isSummaryDelta: boolean,
  summaryIndex?: number,
  contentIndex?: number,
): ChatMessage[] => {
  const list = clone(messages);
  const idx = findByItemId(list, itemId);
  const existing =
    idx >= 0 && list[idx].role === "reasoning" ? list[idx] : undefined;
  const summaryPartsBase =
    existing?.summaryParts ?? getFallbackParts(existing?.summary);
  const contentPartsBase =
    existing?.contentParts ?? getFallbackParts(existing?.content);

  const resolvedSummaryIndex =
    summaryIndex ??
    (summaryPartsBase.length > 0 ? summaryPartsBase.length - 1 : 0);
  const resolvedContentIndex =
    contentIndex ??
    (contentPartsBase.length > 0 ? contentPartsBase.length - 1 : 0);

  const updatedSummaryParts = isSummaryDelta
    ? normalizeReasoningSummaryParts(
        appendPartDelta(summaryPartsBase, resolvedSummaryIndex, deltaText),
      )
    : normalizeReasoningSummaryParts(summaryPartsBase);
  const updatedContentParts = isSummaryDelta
    ? normalizeReasoningContentParts(contentPartsBase)
    : normalizeReasoningContentParts(
        appendPartDelta(contentPartsBase, resolvedContentIndex, deltaText),
      );

  const nextSummary = buildReasoningText(
    updatedSummaryParts,
    existing?.summary,
    normalizeReasoningSummary,
  );
  const nextContent = buildReasoningText(
    updatedContentParts,
    existing?.content,
    normalizeReasoningContent,
  );
  const entry: ChatMessage = {
    id: itemId,
    itemId,
    role: "reasoning",
    text: "",
    summary: nextSummary,
    content: nextContent,
    summaryParts: updatedSummaryParts,
    contentParts: updatedContentParts,
    createdAt: existing?.createdAt ?? now(),
  };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  return list;
};

export const applyUserMessageStart = (
  messages: ChatMessage[],
  itemId: string,
  text: string | undefined,
): ChatMessage[] => {
  const list = clone(messages);
  const existingIdx = findByItemId(list, itemId);
  if (existingIdx >= 0) {
    list[existingIdx] = {
      ...list[existingIdx],
      role: "user",
      itemId,
      pending: false,
      text: preferExistingText(text, list[existingIdx].text),
    };
    return list;
  }
  const pendingIdx = list.findIndex(
    (entry) => entry.role === "user" && entry.pending,
  );
  if (pendingIdx >= 0) {
    list[pendingIdx] = {
      ...list[pendingIdx],
      role: "user",
      itemId,
      pending: false,
      text: preferExistingText(text, list[pendingIdx].text),
    };
    return list;
  }
  list.push({
    id: itemId,
    itemId,
    role: "user",
    text: text ?? "",
    createdAt: now(),
  });
  return list;
};

export const applyAgentMessageStart = (
  messages: ChatMessage[],
  itemId: string,
  text: string,
): ChatMessage[] => {
  const list = clone(messages);
  const existingIdx = findByItemId(list, itemId);
  if (existingIdx >= 0) {
    list[existingIdx] = {
      ...list[existingIdx],
      role: "agent",
      itemId,
      pending: false,
      text,
    };
    return list;
  }
  list.push({
    id: itemId,
    itemId,
    role: "agent",
    text,
    createdAt: now(),
  });
  return list;
};

export const applyReasoningStart = (
  messages: ChatMessage[],
  itemId: string,
  summary: string,
  content: string,
  summaryParts?: string[],
  contentParts?: string[],
): ChatMessage[] => {
  const list = clone(messages);
  const existingIdx = findByItemId(list, itemId);
  const existing =
    existingIdx >= 0 && list[existingIdx].role === "reasoning"
      ? list[existingIdx]
      : undefined;
  const normalizedSummaryParts = normalizeReasoningSummaryParts(
    summaryParts ?? getFallbackParts(summary || existing?.summary),
  );
  const normalizedContentParts = normalizeReasoningContentParts(
    contentParts ?? getFallbackParts(content || existing?.content),
  );
  const entry: ChatMessage = {
    id: itemId,
    itemId,
    role: "reasoning",
    text: "",
    summary: buildReasoningText(
      normalizedSummaryParts,
      summary || existing?.summary,
      normalizeReasoningSummary,
    ),
    content: buildReasoningText(
      normalizedContentParts,
      content || existing?.content,
      normalizeReasoningContent,
    ),
    summaryParts: normalizedSummaryParts,
    contentParts: normalizedContentParts,
    createdAt: existing?.createdAt ?? now(),
  };
  if (existingIdx >= 0) {
    list[existingIdx] = entry;
  } else {
    list.push(entry);
  }
  return list;
};

export const applyReasoningSummaryPartAdded = (
  messages: ChatMessage[],
  itemId: string,
  summaryIndex: number,
): ChatMessage[] => {
  const list = clone(messages);
  const idx = findByItemId(list, itemId);
  const existing =
    idx >= 0 && list[idx].role === "reasoning" ? list[idx] : undefined;
  const summaryPartsBase =
    existing?.summaryParts ?? getFallbackParts(existing?.summary);
  const nextSummaryParts = normalizeReasoningSummaryParts(
    ensurePartIndex(summaryPartsBase, summaryIndex),
  );
  const contentParts = normalizeReasoningContentParts(
    existing?.contentParts ?? getFallbackParts(existing?.content),
  );
  const entry: ChatMessage = {
    id: itemId,
    itemId,
    role: "reasoning",
    text: "",
    summary: buildReasoningText(
      nextSummaryParts,
      existing?.summary,
      normalizeReasoningSummary,
    ),
    content: buildReasoningText(
      contentParts,
      existing?.content,
      normalizeReasoningContent,
    ),
    summaryParts: nextSummaryParts,
    contentParts,
    createdAt: existing?.createdAt ?? now(),
  };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  return list;
};

export const applyFileChangeUpdate = (
  map: Record<string, FileChangeEntry>,
  args: {
    itemId: string;
    turnId?: string;
    status?: string;
    changes: FileChangeEntry["changes"];
  },
): Record<string, FileChangeEntry> => {
  const next = { ...map };
  const existing = next[args.itemId];
  next[args.itemId] = {
    itemId: args.itemId,
    turnId: args.turnId ?? existing?.turnId,
    status: args.status ?? existing?.status,
    changes: args.changes.length > 0 ? args.changes : (existing?.changes ?? []),
    updatedAt: now(),
  };
  return next;
};

export const applyDiffUpdate = (
  diffs: DiffEntry[],
  turnId: string,
  diffText: string,
): DiffEntry[] => {
  const list = clone(diffs);
  const idx = list.findIndex((entry) => entry.turnId === turnId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], diffText, updatedAt: now() };
  } else {
    list.push({ turnId, diffText, updatedAt: now() });
  }
  return list;
};

export const upsertToolItem = (
  map: Record<string, ToolTimelineItem>,
  incoming: ToolTimelineItem,
): Record<string, ToolTimelineItem> => {
  const existing = map[incoming.itemId];
  const createdAt = existing?.createdAt ?? incoming.createdAt;
  const outputStream =
    incoming.outputStream !== undefined
      ? incoming.outputStream
      : existing?.outputStream;
  const progressMessages =
    incoming.progressMessages !== undefined
      ? incoming.progressMessages
      : existing?.progressMessages;
  return {
    ...map,
    [incoming.itemId]: {
      ...existing,
      ...incoming,
      createdAt,
      updatedAt: now(),
      outputStream,
      progressMessages,
    },
  };
};

export const appendToolItemOutputDelta = (
  map: Record<string, ToolTimelineItem>,
  args: {
    itemId: string;
    type: ToolTimelineItem["type"];
    delta: string;
    threadId?: string;
    turnId?: string;
  },
): Record<string, ToolTimelineItem> => {
  const existing = map[args.itemId];
  const createdAt = existing?.createdAt ?? now();
  const outputStream = `${existing?.outputStream ?? ""}${args.delta}`;
  return {
    ...map,
    [args.itemId]: {
      ...existing,
      itemId: args.itemId,
      type: existing?.type ?? args.type,
      threadId: args.threadId ?? existing?.threadId,
      turnId: args.turnId ?? existing?.turnId,
      status: existing?.status ?? "inProgress",
      createdAt,
      updatedAt: now(),
      outputStream,
    },
  };
};

export const appendToolItemProgressMessage = (
  map: Record<string, ToolTimelineItem>,
  args: {
    itemId: string;
    type: ToolTimelineItem["type"];
    message: string;
    threadId?: string;
    turnId?: string;
  },
): Record<string, ToolTimelineItem> => {
  const existing = map[args.itemId];
  const createdAt = existing?.createdAt ?? now();
  const progressMessages = [
    ...(existing?.progressMessages ?? []),
    args.message,
  ];
  return {
    ...map,
    [args.itemId]: {
      ...existing,
      itemId: args.itemId,
      type: existing?.type ?? args.type,
      threadId: args.threadId ?? existing?.threadId,
      turnId: args.turnId ?? existing?.turnId,
      status: existing?.status ?? "inProgress",
      createdAt,
      updatedAt: now(),
      progressMessages,
    },
  };
};

export const removeApproval = (
  approvals: ApprovalRequest[],
  rpcId: number | string,
): ApprovalRequest[] => approvals.filter((item) => item.rpcId !== rpcId);
