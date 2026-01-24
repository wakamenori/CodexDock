import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api";
import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  JsonValue,
  Repo,
  SessionStatus,
  ThreadSummary,
  WsInboundMessage,
  WsOutboundMessage,
} from "../types";
import {
  asRecord,
  appendReasoningContent,
  appendReasoningSummary,
  buildMessagesFromResume,
  createRequestId,
  extractAgentMessageText,
  extractDeltaText,
  extractDiffText,
  extractItemId,
  extractItemRecord,
  extractThreadId,
  extractTurnId,
  extractUserMessageText,
  getIdString,
  getRecordId,
  normalizeRootPath,
  normalizeReasoningContent,
  normalizeReasoningSummary,
} from "../utils/appUtils";

const extractFileChangeEntries = (
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

const extractFileChangeStatus = (item: Record<string, unknown>) => {
  const status = item.status;
  return typeof status === "string" ? status : undefined;
};

const extractFileChangeTurnId = (
  params: unknown,
  item: Record<string, unknown>,
) => {
  const paramsTurnId = extractTurnId(params);
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

type UseAppStateResult = {
  repos: Repo[];
  selectedRepoId: string | null;
  selectedRepo: Repo | null;
  newRepoName: string;
  newRepoPath: string;
  sessionStatus: SessionStatus;
  visibleThreads: ThreadSummary[];
  selectedThreadId: string | null;
  wsConnected: boolean;
  running: boolean;
  errorMessage: string | null;
  messages: ChatMessage[];
  diffs: DiffEntry[];
  fileChanges: Record<string, FileChangeEntry>;
  approvals: ApprovalRequest[];
  inputText: string;
  selectRepo: (repoId: string | null) => void;
  setNewRepoName: (value: string) => void;
  setNewRepoPath: (value: string) => void;
  setInputText: (value: string) => void;
  handleAddRepo: () => Promise<void>;
  handleCreateThread: () => Promise<void>;
  handleSelectThread: (threadId: string) => Promise<void>;
  handleApprove: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
  handleSend: () => Promise<void>;
};

export const useAppState = (): UseAppStateResult => {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [threadsByRepo, setThreadsByRepo] = useState<
    Record<string, ThreadSummary[]>
  >({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [sessionStatusByRepo, setSessionStatusByRepo] = useState<
    Record<string, SessionStatus>
  >({});
  const [messagesByThread, setMessagesByThread] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [diffsByThread, setDiffsByThread] = useState<
    Record<string, DiffEntry[]>
  >({});
  const [fileChangesByThread, setFileChangesByThread] = useState<
    Record<string, Record<string, FileChangeEntry>>
  >({});
  const [approvalsByThread, setApprovalsByThread] = useState<
    Record<string, ApprovalRequest[]>
  >({});
  const [activeTurnByThread, setActiveTurnByThread] = useState<
    Record<string, string | null>
  >({});
  const [inputText, setInputText] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPath, setNewRepoPath] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRepoRef = useRef<string | null>(null);
  const selectedThreadIdRef = useRef<string | null>(null);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.repoId === selectedRepoId) ?? null,
    [repos, selectedRepoId],
  );
  const lastOpenedThreadId = selectedRepo?.lastOpenedThreadId ?? null;
  const normalizedRepoPath = normalizeRootPath(selectedRepo?.path);

  const threads = selectedRepoId ? (threadsByRepo[selectedRepoId] ?? []) : [];
  const visibleThreads = normalizedRepoPath
    ? threads.filter(
        (thread) => normalizeRootPath(thread.cwd) === normalizedRepoPath,
      )
    : threads;
  const messages = selectedThreadId
    ? (messagesByThread[selectedThreadId] ?? [])
    : [];
  const diffs = selectedThreadId ? (diffsByThread[selectedThreadId] ?? []) : [];
  const fileChanges = selectedThreadId
    ? (fileChangesByThread[selectedThreadId] ?? {})
    : {};
  const approvals = selectedThreadId
    ? (approvalsByThread[selectedThreadId] ?? [])
    : [];
  const sessionStatus = selectedRepoId
    ? (sessionStatusByRepo[selectedRepoId] ?? "stopped")
    : "stopped";
  const running = selectedThreadId
    ? Boolean(activeTurnByThread[selectedThreadId])
    : false;

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  const updateThreadMessages = useCallback(
    (threadId: string, updater: (list: ChatMessage[]) => ChatMessage[]) => {
      setMessagesByThread((prev) => {
        const list = updater([...(prev[threadId] ?? [])]);
        return { ...prev, [threadId]: list };
      });
    },
    [],
  );

  const setThreadMessages = useCallback((threadId: string, list: ChatMessage[]) => {
    setMessagesByThread((prev) => {
      return { ...prev, [threadId]: list };
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.listRepos();
        setRepos(data);
        if (data.length > 0) {
          setSelectedRepoId((current) => current ?? data[0].repoId);
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load repos",
        );
      }
    })();
  }, []);

  const sendWs = useCallback((message: WsOutboundMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const handleAppServerNotification = useCallback(
    (_repoId: string, message: { method: string; params?: JsonValue }) => {
      const { method, params } = message;
      const threadId = extractThreadId(params) ?? selectedThreadIdRef.current;
    if (
      method === "item/agentMessage/delta" ||
      method === "item/assistantMessage/delta"
    ) {
        if (!threadId) return;
        const itemId = extractItemId(params, `${method}-${Date.now()}`);
        const deltaText = extractDeltaText(params);
        if (!deltaText) return;
        updateThreadMessages(threadId, (list) => {
          const idx = list.findIndex(
            (item) => item.itemId === itemId || item.id === itemId,
          );
          if (idx >= 0) {
            list[idx] = {
              ...list[idx],
              role: "agent",
              itemId,
              pending: false,
              text: list[idx].text + deltaText,
            };
          } else {
            list.push({
              id: itemId,
              itemId,
              role: "agent",
              text: deltaText,
              createdAt: Date.now(),
            });
          }
          return list;
        });
      return;
    }

    if (
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/textDelta"
    ) {
      if (!threadId) return;
      const itemId = extractItemId(params, `${method}-${Date.now()}`);
      const deltaText = extractDeltaText(params);
      if (!deltaText) return;
      const isSummaryDelta = method === "item/reasoning/summaryTextDelta";
      updateThreadMessages(threadId, (list) => {
        const idx = list.findIndex(
          (entry) => entry.itemId === itemId || entry.id === itemId,
        );
        const existing = idx >= 0 && list[idx].role === "reasoning"
          ? list[idx]
          : undefined;
        const summary = existing?.summary ?? "";
        const content = existing?.content ?? "";
        const nextSummary = isSummaryDelta
          ? appendReasoningSummary(summary, deltaText)
          : normalizeReasoningSummary(summary);
        const nextContent = isSummaryDelta
          ? normalizeReasoningContent(content)
          : appendReasoningContent(content, deltaText);
        const nextEntry = {
          id: itemId,
          itemId,
          role: "reasoning" as const,
          text: "",
          summary: nextSummary,
          content: nextContent,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        if (idx >= 0) {
          list[idx] = nextEntry;
        } else {
          list.push(nextEntry);
        }
        return list;
      });
      return;
    }

      if (method === "item/started" || method === "item/completed") {
        if (!threadId) return;
        const item = extractItemRecord(params);
        const itemType = item?.type;
        if (!item || typeof itemType !== "string") return;
        const itemId = extractItemId(params, `${method}-${Date.now()}`);

        if (itemType === "userMessage") {
          const text = extractUserMessageText(item);
          updateThreadMessages(threadId, (list) => {
            const existingIdx = list.findIndex(
              (entry) => entry.itemId === itemId || entry.id === itemId,
            );
            if (existingIdx >= 0) {
              list[existingIdx] = {
                ...list[existingIdx],
                role: "user",
                itemId,
                pending: false,
                text: text || list[existingIdx].text,
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
                text: text || list[pendingIdx].text,
              };
              return list;
            }
            list.push({
              id: itemId,
              itemId,
              role: "user",
              text,
              createdAt: Date.now(),
            });
            return list;
          });
        }

      if (itemType === "agentMessage") {
        const text = extractAgentMessageText(item);
        if (!text) return;
          updateThreadMessages(threadId, (list) => {
            const existingIdx = list.findIndex(
              (entry) => entry.itemId === itemId || entry.id === itemId,
            );
            if (existingIdx >= 0) {
              list[existingIdx] = {
                ...list[existingIdx],
                role: "agent",
                itemId,
                pending: false,
                text,
              };
            } else {
              list.push({
                id: itemId,
                itemId,
                role: "agent",
                text,
                createdAt: Date.now(),
              });
            }
            return list;
        });
      }
      if (itemType === "reasoning") {
        const summaryFromItem =
          typeof item.summary === "string" ? item.summary : "";
        const contentFromItem =
          typeof item.content === "string" ? item.content : "";
        updateThreadMessages(threadId, (list) => {
          const existingIdx = list.findIndex(
            (entry) => entry.itemId === itemId || entry.id === itemId,
          );
          const existing =
            existingIdx >= 0 && list[existingIdx].role === "reasoning"
              ? list[existingIdx]
              : undefined;
          const summary = summaryFromItem || existing?.summary || "";
          const content = contentFromItem || existing?.content || "";
          const nextEntry = {
            id: itemId,
            itemId,
            role: "reasoning" as const,
            text: "",
            summary: normalizeReasoningSummary(summary),
            content: normalizeReasoningContent(content),
            createdAt: existing?.createdAt ?? Date.now(),
          };
          if (existingIdx >= 0) {
            list[existingIdx] = nextEntry;
          } else {
            list.push(nextEntry);
          }
          return list;
        });
      }

      if (itemType === "fileChange") {
        const itemChanges = extractFileChangeEntries(item);
        const status = extractFileChangeStatus(item);
        const turnId = extractFileChangeTurnId(params, item);
        setFileChangesByThread((prev) => {
          const threadMap = { ...(prev[threadId] ?? {}) };
          const existing = threadMap[itemId];
          threadMap[itemId] = {
            itemId,
            turnId: turnId ?? existing?.turnId,
            status: status ?? existing?.status,
            changes: itemChanges.length > 0 ? itemChanges : existing?.changes ?? [],
            updatedAt: Date.now(),
          };
          return { ...prev, [threadId]: threadMap };
        });
      }
      return;
    }

      if (method === "turn/diff/updated") {
        if (!threadId) return;
        const turnId = extractTurnId(params) ?? `${Date.now()}`;
        const diffText = extractDiffText(params);
        setDiffsByThread((prev) => {
          const list = [...(prev[threadId] ?? [])];
          const idx = list.findIndex((entry) => entry.turnId === turnId);
          if (idx >= 0) {
            list[idx] = { ...list[idx], diffText, updatedAt: Date.now() };
          } else {
            list.push({ turnId, diffText, updatedAt: Date.now() });
          }
          return { ...prev, [threadId]: list };
        });
      }

      if (method === "turn/started") {
        const turnId = extractTurnId(params) ?? null;
        if (turnId && threadId) {
          setActiveTurnByThread((prev) => ({
            ...prev,
            [threadId]: String(turnId),
          }));
        }
      }

      if (method === "turn/completed" || method === "turn/failed") {
        if (threadId) {
          setActiveTurnByThread((prev) => ({ ...prev, [threadId]: null }));
        }
      }
    },
    [updateThreadMessages],
  );

  const handleAppServerRequest = useCallback(
    (
      _repoId: string,
      message: { id: number | string; method: string; params?: JsonValue },
    ) => {
      const paramsRecord = asRecord(message.params);
      const entry: ApprovalRequest = {
        rpcId: message.id,
        method: message.method,
        params: message.params,
        receivedAt: Date.now(),
        threadId: paramsRecord
          ? (getIdString(paramsRecord.threadId) ??
              getIdString(paramsRecord.thread_id))
          : undefined,
        turnId: paramsRecord
          ? (getIdString(paramsRecord.turnId) ?? getIdString(paramsRecord.turn_id))
          : undefined,
        itemId: paramsRecord
          ? (getIdString(paramsRecord.itemId) ?? getIdString(paramsRecord.item_id))
          : undefined,
      };
      const threadId = entry.threadId ?? selectedThreadIdRef.current;
      if (!threadId) return;
      setApprovalsByThread((prev) => {
        const list = [...(prev[threadId] ?? []), entry];
        return { ...prev, [threadId]: list };
      });
    },
    [],
  );

  const handleWsMessage = useCallback(
    (message: WsInboundMessage) => {
      switch (message.type) {
        case "subscribe_error":
          setErrorMessage(message.payload.error.message);
          break;
        case "session_status":
          setSessionStatusByRepo((prev) => ({
            ...prev,
            [message.payload.repoId]: message.payload.status,
          }));
          break;
        case "thread_list_updated":
          setThreadsByRepo((prev) => ({
            ...prev,
            [message.payload.repoId]: message.payload.threads,
          }));
          break;
        case "app_server_notification":
          handleAppServerNotification(
            message.payload.repoId,
            message.payload.message,
          );
          break;
        case "app_server_request":
          handleAppServerRequest(message.payload.repoId, message.payload.message);
          break;
        default:
          break;
      }
    },
    [handleAppServerNotification, handleAppServerRequest],
  );

  useEffect(() => {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    wsRef.current = ws;

    ws.addEventListener("open", () => setWsConnected(true));
    ws.addEventListener("close", () => setWsConnected(false));
    ws.addEventListener("error", () => setWsConnected(false));
    ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data) as WsInboundMessage;
        handleWsMessage(message);
      } catch (error) {
        console.warn("WS message parse error", error);
      }
    });

    return () => {
      ws.close();
    };
  }, [handleWsMessage]);

  useEffect(() => {
    if (!wsConnected || !selectedRepoId || !wsRef.current) return;
    const previousRepoId = subscribedRepoRef.current;
    if (previousRepoId && previousRepoId !== selectedRepoId) {
      sendWs({
        type: "unsubscribe",
        requestId: createRequestId(),
        payload: { repoId: previousRepoId },
      });
    }
    subscribedRepoRef.current = selectedRepoId;
    sendWs({
      type: "subscribe",
      requestId: createRequestId(),
      payload: { repoId: selectedRepoId },
    });
  }, [sendWs, selectedRepoId, wsConnected]);

  useEffect(() => {
    if (!selectedRepoId) return;
    void (async () => {
      try {
        await api.startSession(selectedRepoId);
        const list = await api.listThreads(selectedRepoId);
        setThreadsByRepo((prev) => ({ ...prev, [selectedRepoId]: list }));
        const filtered = normalizedRepoPath
          ? list.filter(
              (thread) => normalizeRootPath(thread.cwd) === normalizedRepoPath,
            )
          : list;
        const preferred = lastOpenedThreadId ?? filtered[0]?.threadId ?? null;
        setSelectedThreadId(preferred);
        if (preferred) {
          const resumeResult = await api.resumeThread(
            selectedRepoId,
            preferred,
          );
          const resumeMessages = buildMessagesFromResume(
            preferred,
            resumeResult,
          );
          setThreadMessages(preferred, resumeMessages);
          await api.updateRepo(selectedRepoId, {
            lastOpenedThreadId: preferred,
          });
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to start session",
        );
      }
    })();
  }, [lastOpenedThreadId, normalizedRepoPath, selectedRepoId, setThreadMessages]);

  const handleApprove = useCallback(
    (repoId: string, request: ApprovalRequest, decision: "accept" | "decline") => {
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
      const threadId = request.threadId ?? selectedThreadIdRef.current;
      if (!threadId) return;
      setApprovalsByThread((prev) => {
        const list = (prev[threadId] ?? []).filter(
          (item) => item.rpcId !== request.rpcId,
        );
        return { ...prev, [threadId]: list };
      });
    },
    [sendWs],
  );

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!selectedRepoId || !selectedThreadId || !text) return;
    const pendingId = `pending-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    updateThreadMessages(selectedThreadId, (list) => {
      list.push({
        id: pendingId,
        role: "user",
        text,
        createdAt: Date.now(),
        pending: true,
      });
      return list;
    });
    try {
      const turn = await api.startTurn(selectedRepoId, selectedThreadId, [
        { type: "text", text },
      ]);
      setActiveTurnByThread((prev) => ({
        ...prev,
        [selectedThreadId]: turn.turnId,
      }));
      setInputText("");
    } catch (error) {
      updateThreadMessages(selectedThreadId, (list) =>
        list.filter((item) => item.id !== pendingId),
      );
      setErrorMessage(error instanceof Error ? error.message : "Turn failed");
    }
  }, [inputText, selectedRepoId, selectedThreadId, updateThreadMessages]);

  const handleCreateThread = useCallback(async () => {
    if (!selectedRepoId) return;
    try {
      const threadId = await api.createThread(selectedRepoId);
      await api.resumeThread(selectedRepoId, threadId);
      setSelectedThreadId(threadId);
      await api.updateRepo(selectedRepoId, { lastOpenedThreadId: threadId });
      const list = await api.listThreads(selectedRepoId);
      setThreadsByRepo((prev) => ({ ...prev, [selectedRepoId]: list }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create thread",
      );
    }
  }, [selectedRepoId]);

  const handleSelectThread = useCallback(
    async (threadId: string) => {
      if (!selectedRepoId) return;
      setSelectedThreadId(threadId);
      try {
        const resumeResult = await api.resumeThread(selectedRepoId, threadId);
        const resumeMessages = buildMessagesFromResume(threadId, resumeResult);
        setThreadMessages(threadId, resumeMessages);
        await api.updateRepo(selectedRepoId, { lastOpenedThreadId: threadId });
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to resume thread",
        );
      }
    },
    [selectedRepoId, setThreadMessages],
  );

  const handleAddRepo = useCallback(async () => {
    if (!newRepoName.trim() || !newRepoPath.trim()) return;
    try {
      const repo = await api.createRepo(newRepoName.trim(), newRepoPath.trim());
      setRepos((prev) => [...prev, repo]);
      setSelectedRepoId(repo.repoId);
      setNewRepoName("");
      setNewRepoPath("");
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : "Failed to add repo",
      );
    }
  }, [newRepoName, newRepoPath]);

  const selectRepo = useCallback((repoId: string | null) => {
    setSelectedRepoId(repoId);
  }, []);

  return {
    repos,
    selectedRepoId,
    selectedRepo,
    newRepoName,
    newRepoPath,
    sessionStatus,
    visibleThreads,
    selectedThreadId,
    wsConnected,
    running,
    errorMessage,
    messages,
    diffs,
    fileChanges,
    approvals,
    inputText,
    selectRepo,
    setNewRepoName,
    setNewRepoPath,
    setInputText,
    handleAddRepo,
    handleCreateThread,
    handleSelectThread,
    handleApprove,
    handleSend,
  };
};
