import { asRecord, getIdString } from "../../../shared/records";
import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  JsonValue,
  ThreadStatusFlags,
  ToolTimelineItem,
  WsInboundMessage,
} from "../../../types";
import {
  parseAgentMessageText,
  parseDeltaText,
  parseDiffText,
  parseFileChangeEntries,
  parseFileChangeStatus,
  parseFileChangeTurnId,
  parseItemId,
  parseItemRecord,
  parseReasoningContentIndex,
  parseReasoningItemParts,
  parseReasoningSummaryIndex,
  parseThreadId,
  parseToolItem,
  parseTurnId,
  parseUserMessageText,
} from "../domain/parsers";
import {
  appendToolItemOutputDelta,
  appendToolItemProgressMessage,
  applyAgentMessageStart,
  applyDiffUpdate,
  applyFileChangeUpdate,
  applyReasoningStart,
  applyReasoningSummaryPartAdded,
  applyUserMessageStart,
  upsertAgentDelta,
  upsertReasoningDelta,
  upsertToolItem,
} from "../domain/state";

type ThreadStateStore = {
  getSelectedThreadId: () => string | null;
  updateMessages: (
    threadId: string,
    updater: (list: ChatMessage[]) => ChatMessage[],
  ) => void;
  updateDiffs: (
    threadId: string,
    updater: (list: DiffEntry[]) => DiffEntry[],
  ) => void;
  updateFileChanges: (
    threadId: string,
    updater: (
      map: Record<string, FileChangeEntry>,
    ) => Record<string, FileChangeEntry>,
  ) => void;
  updateToolItems: (
    threadId: string,
    updater: (
      map: Record<string, ToolTimelineItem>,
    ) => Record<string, ToolTimelineItem>,
  ) => void;
  updateApprovals: (
    threadId: string,
    updater: (list: ApprovalRequest[]) => ApprovalRequest[],
  ) => void;
  setActiveTurn: (threadId: string, turnId: string | null) => void;
  updateThreadStatus: (
    threadId: string,
    updater: (status: ThreadStatusFlags) => ThreadStatusFlags,
  ) => void;
};

const ensureThreadId = (
  store: ThreadStateStore,
  params?: JsonValue,
): string | null => parseThreadId(params) ?? store.getSelectedThreadId();

export const createWsEventHandlers = (store: ThreadStateStore) => {
  const handleAppServerNotification = (
    _repoId: string,
    message: { method: string; params?: JsonValue },
  ) => {
    const { method, params } = message;
    const threadId = ensureThreadId(store, params);
    if (!threadId) return;
    const setProcessing = (value: boolean) => {
      store.updateThreadStatus(threadId, (status) => ({
        ...status,
        processing: value,
      }));
    };
    const setReviewing = (value: boolean) => {
      store.updateThreadStatus(threadId, (status) => ({
        ...status,
        reviewing: value,
      }));
    };
    const setUnread = (value: boolean) => {
      store.updateThreadStatus(threadId, (status) => ({
        ...status,
        unread: value,
      }));
    };
    const isDeltaMethod = method.includes("/delta") || method.endsWith("Delta");
    if (isDeltaMethod) {
      setProcessing(true);
    }

    if (
      method === "item/agentMessage/delta" ||
      method === "item/assistantMessage/delta"
    ) {
      const itemId = parseItemId(params, `${method}-${Date.now()}`);
      const deltaText = parseDeltaText(params);
      if (!deltaText) return;
      store.updateMessages(threadId, (list) =>
        upsertAgentDelta(list, itemId, deltaText),
      );
      return;
    }

    if (method === "item/commandExecution/outputDelta") {
      const itemId = parseItemId(params, `${method}-${Date.now()}`);
      const deltaText = parseDeltaText(params);
      if (!deltaText) return;
      const turnId = parseTurnId(params);
      store.updateToolItems(threadId, (map) =>
        appendToolItemOutputDelta(map, {
          itemId,
          type: "commandExecution",
          delta: deltaText,
          threadId,
          turnId,
        }),
      );
      return;
    }

    if (method === "item/fileChange/outputDelta") {
      const itemId = parseItemId(params, `${method}-${Date.now()}`);
      const deltaText = parseDeltaText(params);
      if (!deltaText) return;
      const turnId = parseTurnId(params);
      store.updateToolItems(threadId, (map) =>
        appendToolItemOutputDelta(map, {
          itemId,
          type: "fileChange",
          delta: deltaText,
          threadId,
          turnId,
        }),
      );
      return;
    }

    if (method === "item/mcpToolCall/progress") {
      const itemId = parseItemId(params, `${method}-${Date.now()}`);
      const message = parseDeltaText(params);
      if (!message) return;
      const turnId = parseTurnId(params);
      store.updateToolItems(threadId, (map) =>
        appendToolItemProgressMessage(map, {
          itemId,
          type: "mcpToolCall",
          message,
          threadId,
          turnId,
        }),
      );
      return;
    }

    if (
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/textDelta"
    ) {
      const itemId = parseItemId(params, `${method}-${Date.now()}`);
      const deltaText = parseDeltaText(params);
      if (!deltaText) return;
      const isSummaryDelta = method === "item/reasoning/summaryTextDelta";
      const summaryIndex = isSummaryDelta
        ? parseReasoningSummaryIndex(params)
        : undefined;
      const contentIndex = !isSummaryDelta
        ? parseReasoningContentIndex(params)
        : undefined;
      store.updateMessages(threadId, (list) =>
        upsertReasoningDelta(
          list,
          itemId,
          deltaText,
          isSummaryDelta,
          summaryIndex,
          contentIndex,
        ),
      );
      return;
    }

    if (method === "item/reasoning/summaryPartAdded") {
      const itemId = parseItemId(params, `${method}-${Date.now()}`);
      const summaryIndex = parseReasoningSummaryIndex(params);
      if (summaryIndex === undefined) return;
      store.updateMessages(threadId, (list) =>
        applyReasoningSummaryPartAdded(list, itemId, summaryIndex),
      );
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      setProcessing(true);
      const item = parseItemRecord(params);
      const itemType = item?.type;
      if (!item || typeof itemType !== "string") return;
      const itemId = parseItemId(params, `${method}-${Date.now()}`);

      if (itemType === "userMessage") {
        const text = parseUserMessageText(item);
        store.updateMessages(threadId, (list) =>
          applyUserMessageStart(list, itemId, text),
        );
      }

      if (itemType === "agentMessage" || itemType === "assistantMessage") {
        const text = parseAgentMessageText(item);
        if (!text) return;
        store.updateMessages(threadId, (list) =>
          applyAgentMessageStart(list, itemId, text),
        );
      }

      if (itemType === "reasoning") {
        const { summaryParts, contentParts, summaryText, contentText } =
          parseReasoningItemParts(item);
        store.updateMessages(threadId, (list) =>
          applyReasoningStart(
            list,
            itemId,
            summaryText,
            contentText,
            summaryParts,
            contentParts,
          ),
        );
      }

      if (itemType === "fileChange") {
        const itemChanges = parseFileChangeEntries(item);
        const status = parseFileChangeStatus(item);
        const turnId = parseFileChangeTurnId(params, item);
        store.updateFileChanges(threadId, (prev) =>
          applyFileChangeUpdate(prev, {
            itemId,
            turnId: turnId ?? undefined,
            status: status ?? undefined,
            changes: itemChanges,
          }),
        );
      }

      const toolItem = parseToolItem(params, item, Date.now());
      if (toolItem) {
        store.updateToolItems(threadId, (map) => upsertToolItem(map, toolItem));
      }
      if (itemType === "enteredReviewMode") {
        setReviewing(true);
      }
      if (itemType === "exitedReviewMode") {
        setReviewing(false);
        setProcessing(false);
      }
      if (
        method === "item/completed" &&
        (itemType === "agentMessage" || itemType === "assistantMessage")
      ) {
        setProcessing(false);
        const selectedThreadId = store.getSelectedThreadId();
        if (selectedThreadId && selectedThreadId !== threadId) {
          setUnread(true);
        }
      }
      return;
    }

    if (method === "turn/diff/updated") {
      const turnId = parseTurnId(params) ?? `${Date.now()}`;
      const diffText = parseDiffText(params);
      store.updateDiffs(threadId, (diffs) =>
        applyDiffUpdate(diffs, turnId, diffText),
      );
    }

    if (method === "turn/started") {
      const turnId = parseTurnId(params) ?? null;
      if (turnId) {
        store.setActiveTurn(threadId, String(turnId));
      }
      setProcessing(true);
    }

    if (
      method === "turn/completed" ||
      method === "turn/failed" ||
      method === "turn/error"
    ) {
      store.setActiveTurn(threadId, null);
      setProcessing(false);
      if (method !== "turn/completed") {
        setReviewing(false);
      }
    }
  };

  const handleAppServerRequest = (
    _repoId: string,
    message: { id: number | string; method: string; params?: JsonValue },
  ) => {
    const paramsRecord = asRecord(message.params);
    const parsedThreadId = parseThreadId(message.params);
    const entry: ApprovalRequest = {
      rpcId: message.id,
      method: message.method,
      params: message.params,
      receivedAt: Date.now(),
      threadId: parsedThreadId,
      turnId: paramsRecord
        ? (getIdString(paramsRecord.turnId) ??
          getIdString(paramsRecord.turn_id))
        : undefined,
      itemId: paramsRecord
        ? (getIdString(paramsRecord.itemId) ??
          getIdString(paramsRecord.item_id))
        : undefined,
    };
    const threadId = entry.threadId ?? store.getSelectedThreadId();
    if (!threadId) return;
    store.updateApprovals(threadId, (list) => [...list, entry]);
    const selectedThreadId = store.getSelectedThreadId();
    if (selectedThreadId && selectedThreadId !== threadId) {
      store.updateThreadStatus(threadId, (status) => ({
        ...status,
        unread: true,
      }));
    }
  };

  return {
    handleAppServerNotification,
    handleAppServerRequest,
  };
};

export type WsHandlers = ReturnType<typeof createWsEventHandlers>;

export const isThreadListUpdated = (
  message: WsInboundMessage,
): message is Extract<WsInboundMessage, { type: "thread_list_updated" }> =>
  message.type === "thread_list_updated";

export const isSessionStatus = (
  message: WsInboundMessage,
): message is Extract<WsInboundMessage, { type: "session_status" }> =>
  message.type === "session_status";
