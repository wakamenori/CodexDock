import { asRecord, getIdString } from "../../../shared/records";
import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  JsonValue,
  ThreadStatusFlags,
  WsInboundMessage,
} from "../../../types";
import {
  appendReasoningContent,
  appendReasoningSummary,
  buildMessagesFromResume,
  parseAgentMessageText,
  parseDeltaText,
  parseDiffText,
  parseFileChangeEntries,
  parseFileChangeStatus,
  parseFileChangeTurnId,
  parseItemId,
  parseItemRecord,
  parseThreadId,
  parseTurnId,
  parseUserMessageText,
} from "../domain/parsers";
import {
  applyAgentMessageStart,
  applyDiffUpdate,
  applyFileChangeUpdate,
  applyReasoningStart,
  applyUserMessageStart,
  removeApproval,
  upsertAgentDelta,
  upsertReasoningDelta,
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

    if (
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/textDelta"
    ) {
      const itemId = parseItemId(params, `${method}-${Date.now()}`);
      const deltaText = parseDeltaText(params);
      if (!deltaText) return;
      const isSummaryDelta = method === "item/reasoning/summaryTextDelta";
      store.updateMessages(threadId, (list) =>
        upsertReasoningDelta(list, itemId, deltaText, isSummaryDelta),
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
        const summaryFromItem =
          typeof item.summary === "string" ? item.summary : "";
        const contentFromItem =
          typeof item.content === "string" ? item.content : "";
        store.updateMessages(threadId, (list) =>
          applyReasoningStart(
            list,
            itemId,
            appendReasoningSummary("", summaryFromItem),
            appendReasoningContent("", contentFromItem),
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
