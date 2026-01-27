import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { asRecord, getIdString } from "../../../shared/records";
import type {
  ApprovalRequest,
  JsonValue,
  WsInboundMessage,
  WsOutboundMessage,
} from "../../../types";
import {
  buildApprovalMessageText,
  extractCommandTextFromItem,
  extractCommandTextFromParams,
  extractCwdFromItem,
  extractCwdFromParams,
  outcomeFromDecision,
  outcomeFromStatus,
} from "../domain/approval";
import {
  appendReasoningContent,
  appendReasoningSummary,
  createRequestId,
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
import type { ConversationStore } from "../store/store";

export type WsEffects = {
  connect: () => void;
  disconnect: () => void;
  approveRequest: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
};

const isDeltaMethod = (method: string) =>
  method.includes("/delta") || method.endsWith("Delta");

export const useWsEffects = (store: ConversationStore): WsEffects => {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedReposRef = useRef<Set<string>>(new Set());
  const reconnectTimerRef = useRef<number | null>(null);
  const manualCloseRef = useRef(false);
  const autoApprovedItemsRef = useRef<Record<string, Set<string>>>({});

  const sendWs = useCallback((message: WsOutboundMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const ensureSubscribedRepos = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const desired = new Set(store.getState().repos.map((repo) => repo.repoId));
    const subscribed = subscribedReposRef.current;
    for (const repoId of desired) {
      if (subscribed.has(repoId)) continue;
      sendWs({
        type: "subscribe",
        requestId: createRequestId(),
        payload: { repoId },
      });
      subscribed.add(repoId);
    }
    for (const repoId of Array.from(subscribed)) {
      if (desired.has(repoId)) continue;
      sendWs({
        type: "unsubscribe",
        requestId: createRequestId(),
        payload: { repoId },
      });
      subscribed.delete(repoId);
    }
  }, [sendWs, store]);

  const appendAutoApproval = useCallback(
    (repoId: string, threadId: string, item: Record<string, unknown>) => {
      const permissionMode = store.getState().permissionMode;
      if (permissionMode !== "FullAccess") return;
      const itemId = parseItemId(item, `${Date.now()}`);
      const seen = autoApprovedItemsRef.current[threadId] ?? new Set<string>();
      if (seen.has(itemId)) return;
      seen.add(itemId);
      autoApprovedItemsRef.current[threadId] = seen;
      const itemType = item.type;
      if (itemType !== "commandExecution" && itemType !== "fileChange") return;
      const kind = itemType === "commandExecution" ? "command" : "fileChange";
      const status = typeof item.status === "string" ? item.status : null;
      const outcome = outcomeFromStatus(status) ?? "approved";
      const commandText =
        kind === "command" ? extractCommandTextFromItem(item) : null;
      const cwd = kind === "command" ? extractCwdFromItem(item) : null;
      const fileChanges =
        kind === "fileChange" ? parseFileChangeEntries(item) : null;
      const repoRoot = store
        .getState()
        .repos.find((repo) => repo.repoId === repoId)?.path;
      const text = buildApprovalMessageText({
        kind,
        outcome,
        commandText,
        cwd,
        fileChanges,
        repoRoot: repoRoot ?? null,
      });
      store.dispatch({
        type: "message/append",
        threadId,
        message: {
          id: createRequestId(),
          itemId,
          role: "agent",
          text,
          approval: {
            kind,
            outcome,
            commandText,
            cwd,
            fileChanges: fileChanges ?? undefined,
          },
          createdAt: Date.now(),
        },
      });
    },
    [store],
  );

  const handleNotification = useCallback(
    (repoId: string, message: { method: string; params?: JsonValue }) => {
      const { method, params } = message;
      const threadId =
        parseThreadId(params) ?? store.getState().focusedThreadId;
      if (!threadId) return;
      const state = store.getState();
      const focusedThreadId = state.focusedThreadId;
      const markUnreadIfBackground = () => {
        if (focusedThreadId && focusedThreadId !== threadId) {
          store.dispatch({
            type: "thread/status",
            threadId,
            patch: { unread: true },
          });
        }
      };

      if (isDeltaMethod(method)) {
        store.dispatch({
          type: "thread/status",
          threadId,
          patch: { processing: true },
        });
      }

      if (
        method === "item/agentMessage/delta" ||
        method === "item/assistantMessage/delta"
      ) {
        const itemId = parseItemId(params, `${method}-${Date.now()}`);
        const deltaText = parseDeltaText(params);
        if (!deltaText) return;
        store.dispatch({
          type: "message/delta",
          threadId,
          itemId,
          deltaText,
        });
        return;
      }

      if (
        method === "item/reasoning/summaryTextDelta" ||
        method === "item/reasoning/textDelta"
      ) {
        const itemId = parseItemId(params, `${method}-${Date.now()}`);
        const deltaText = parseDeltaText(params);
        if (!deltaText) return;
        store.dispatch({
          type: "reasoning/delta",
          threadId,
          itemId,
          deltaText,
          isSummary: method === "item/reasoning/summaryTextDelta",
        });
        return;
      }

      if (method === "item/started" || method === "item/completed") {
        const item = parseItemRecord(params);
        const itemType = item?.type;
        if (!item || typeof itemType !== "string") return;
        const itemId = parseItemId(params, `${method}-${Date.now()}`);

        if (itemType === "userMessage") {
          const text = parseUserMessageText(item);
          store.dispatch({
            type: "message/started",
            threadId,
            itemId,
            role: "user",
            text,
          });
        }

        if (itemType === "agentMessage" || itemType === "assistantMessage") {
          const text = parseAgentMessageText(item);
          store.dispatch({
            type: "message/started",
            threadId,
            itemId,
            role: itemType === "agentMessage" ? "agent" : "assistant",
            text,
          });
          if (method === "item/completed") {
            markUnreadIfBackground();
          }
        }

        if (itemType === "reasoning") {
          const summaryFromItem =
            typeof item.summary === "string" ? item.summary : "";
          const contentFromItem =
            typeof item.content === "string" ? item.content : "";
          store.dispatch({
            type: "reasoning/started",
            threadId,
            itemId,
            summary: appendReasoningSummary("", summaryFromItem),
            content: appendReasoningContent("", contentFromItem),
          });
        }

        if (itemType === "fileChange") {
          const changes = parseFileChangeEntries(item);
          const status = parseFileChangeStatus(item);
          const turnId = parseFileChangeTurnId(params, item);
          store.dispatch({
            type: "fileChange/updated",
            threadId,
            itemId,
            turnId: turnId ?? undefined,
            status: status ?? undefined,
            changes,
          });
        }

        if (itemType === "enteredReviewMode") {
          store.dispatch({
            type: "thread/status",
            threadId,
            patch: { reviewing: true },
          });
        }
        if (itemType === "exitedReviewMode") {
          store.dispatch({
            type: "thread/status",
            threadId,
            patch: { reviewing: false },
          });
        }

        if (
          method === "item/completed" &&
          (itemType === "commandExecution" || itemType === "fileChange")
        ) {
          appendAutoApproval(repoId, threadId, item);
        }

        return;
      }

      if (method === "turn/diff/updated") {
        const turnId = parseTurnId(params) ?? `${Date.now()}`;
        const diffText = parseDiffText(params);
        store.dispatch({
          type: "diff/updated",
          threadId,
          turnId,
          diffText,
        });
        return;
      }

      if (method === "turn/started") {
        const turnId = parseTurnId(params);
        if (turnId) {
          store.dispatch({ type: "turn/started", threadId, turnId });
        }
        return;
      }

      if (
        method === "turn/completed" ||
        method === "turn/failed" ||
        method === "turn/error"
      ) {
        store.dispatch({
          type: "turn/finished",
          threadId,
          status:
            method === "turn/completed"
              ? "completed"
              : method === "turn/failed"
                ? "failed"
                : "error",
        });
        return;
      }
    },
    [appendAutoApproval, store],
  );

  const handleRequest = useCallback(
    (
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
      const threadId = entry.threadId ?? store.getState().focusedThreadId;
      if (!threadId) return;
      store.dispatch({ type: "approval/received", threadId, request: entry });
      const focusedThreadId = store.getState().focusedThreadId;
      if (focusedThreadId && focusedThreadId !== threadId) {
        store.dispatch({
          type: "thread/status",
          threadId,
          patch: { unread: true },
        });
      }
    },
    [store],
  );

  const handleWsMessage = useCallback(
    (message: WsInboundMessage) => {
      switch (message.type) {
        case "subscribe_error":
          toast.error(message.payload.error.message);
          break;
        case "session_status":
          store.dispatch({
            type: "session/status",
            repoId: message.payload.repoId,
            status: message.payload.status,
          });
          break;
        case "thread_list_updated":
          store.dispatch({
            type: "threads/loaded",
            repoId: message.payload.repoId,
            threads: message.payload.threads,
          });
          break;
        case "app_server_notification":
          handleNotification(message.payload.repoId, message.payload.message);
          break;
        case "app_server_request":
          handleRequest(message.payload.repoId, message.payload.message);
          break;
        default:
          break;
      }
    },
    [handleNotification, handleRequest, store],
  );

  const connect = useCallback(() => {
    if (typeof WebSocket === "undefined") return;
    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    }
    manualCloseRef.current = false;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      subscribedReposRef.current = new Set();
      store.dispatch({ type: "connection/status", wsConnected: true });
      ensureSubscribedRepos();
    });
    ws.addEventListener("close", () => {
      store.dispatch({ type: "connection/status", wsConnected: false });
      if (manualCloseRef.current) return;
      if (reconnectTimerRef.current) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 1000);
    });
    ws.addEventListener("error", () => {
      store.dispatch({ type: "connection/status", wsConnected: false });
    });
    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsInboundMessage;
        handleWsMessage(parsed);
      } catch (error) {
        console.warn("WS message parse error", error);
      }
    });
  }, [ensureSubscribedRepos, handleWsMessage, store]);

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    store.dispatch({ type: "connection/status", wsConnected: false });
  }, [store]);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => ensureSubscribedRepos());
    return unsubscribe;
  }, [ensureSubscribedRepos, store]);

  useEffect(() => () => disconnect(), [disconnect]);

  const approveRequest = useCallback(
    (
      repoId: string,
      request: ApprovalRequest,
      decision: "accept" | "decline",
    ) => {
      sendWs({
        type: "app_server_response",
        payload: {
          repoId,
          message: {
            id: request.rpcId,
            result: { decision },
          },
        },
      });
      const threadId = request.threadId ?? store.getState().focusedThreadId;
      if (!threadId) return;
      const isCommandApproval =
        request.method === "item/commandExecution/requestApproval";
      const isFileChangeApproval =
        request.method === "item/fileChange/requestApproval";
      if (isCommandApproval || isFileChangeApproval) {
        const state = store.getState();
        const changes =
          isFileChangeApproval && request.itemId
            ? (state.fileChangesByThread[threadId]?.[request.itemId]?.changes ??
              [])
            : [];
        const commandText = isCommandApproval
          ? extractCommandTextFromParams(request.params)
          : null;
        const cwd = isCommandApproval
          ? extractCwdFromParams(request.params)
          : null;
        const outcome = outcomeFromDecision(decision);
        const repoRoot =
          state.repos.find((repo) => repo.repoId === repoId)?.path ?? null;
        const text = buildApprovalMessageText({
          kind: isCommandApproval ? "command" : "fileChange",
          outcome,
          commandText,
          cwd,
          fileChanges: changes,
          repoRoot,
        });
        store.dispatch({
          type: "message/append",
          threadId,
          message: {
            id: createRequestId(),
            itemId: request.itemId,
            role: "agent",
            text,
            approval: {
              kind: isCommandApproval ? "command" : "fileChange",
              outcome,
              commandText,
              cwd,
              fileChanges: changes,
            },
            createdAt: Date.now(),
          },
        });
      }
      store.dispatch({
        type: "approval/resolved",
        threadId,
        rpcId: request.rpcId,
      });
    },
    [sendWs, store],
  );

  return useMemo(
    () => ({ connect, disconnect, approveRequest }),
    [approveRequest, connect, disconnect],
  );
};
