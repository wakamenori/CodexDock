import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
} from "../../../types";
import {
  appendReasoningContent,
  appendReasoningSummary,
  normalizeReasoningContent,
  normalizeReasoningSummary,
} from "./parsers";

const now = () => Date.now();

const clone = <T>(value: T[]): T[] => [...value];

const findByItemId = (messages: ChatMessage[], itemId: string) =>
  messages.findIndex((item) => item.itemId === itemId || item.id === itemId);

const preferExistingText = (
  incoming: string | undefined,
  existing: string,
): string => (incoming && incoming.length > 0 ? incoming : existing);

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
): ChatMessage[] => {
  const list = clone(messages);
  const idx = findByItemId(list, itemId);
  const existing =
    idx >= 0 && list[idx].role === "reasoning" ? list[idx] : undefined;
  const summary = existing?.summary ?? "";
  const content = existing?.content ?? "";
  const nextSummary = isSummaryDelta
    ? appendReasoningSummary(summary, deltaText)
    : normalizeReasoningSummary(summary);
  const nextContent = isSummaryDelta
    ? normalizeReasoningContent(content)
    : appendReasoningContent(content, deltaText);
  const entry: ChatMessage = {
    id: itemId,
    itemId,
    role: "reasoning",
    text: "",
    summary: nextSummary,
    content: nextContent,
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
): ChatMessage[] => {
  const list = clone(messages);
  const existingIdx = findByItemId(list, itemId);
  const existing =
    existingIdx >= 0 && list[existingIdx].role === "reasoning"
      ? list[existingIdx]
      : undefined;
  const entry: ChatMessage = {
    id: itemId,
    itemId,
    role: "reasoning",
    text: "",
    summary: normalizeReasoningSummary(summary || existing?.summary || ""),
    content: normalizeReasoningContent(content || existing?.content || ""),
    createdAt: existing?.createdAt ?? now(),
  };
  if (existingIdx >= 0) {
    list[existingIdx] = entry;
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

export const removeApproval = (
  approvals: ApprovalRequest[],
  rpcId: number | string,
): ApprovalRequest[] => approvals.filter((item) => item.rpcId !== rpcId);
