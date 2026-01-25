import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "../../../api";
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
} from "../../../types";
import {
  buildMessagesFromResume,
  createRequestId,
  normalizeRootPath,
} from "../domain/parsers";
import { createWsEventHandlers } from "../infra/wsHandlers";
import { extractRepoName } from "../../../shared/paths";

export type UseAppStateResult = {
  repos: Repo[];
  repoGroups: {
    repo: Repo;
    threads: ThreadSummary[];
    sessionStatus: SessionStatus;
  }[];
  selectedRepoId: string | null;
  selectedRepo: Repo | null;
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
  setInputText: (value: string) => void;
  handleAddRepo: () => Promise<void>;
  handleCreateThread: () => Promise<void>;
  handleSelectThread: (repoId: string, threadId: string) => Promise<void>;
  handleApprove: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
  handleSend: () => Promise<void>;
};

export const useConversationState = (): UseAppStateResult => {
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

  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRepoRef = useRef<string | null>(null);
  const selectedThreadIdRef = useRef<string | null>(null);
  const pendingThreadSelectionRef = useRef<{
    repoId: string;
    threadId: string;
  } | null>(null);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.repoId === selectedRepoId) ?? null,
    [repos, selectedRepoId],
  );
  const lastOpenedThreadId = selectedRepo?.lastOpenedThreadId ?? null;
  const normalizedRepoPath = normalizeRootPath(selectedRepo?.path);

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
  const running = selectedThreadId
    ? Boolean(activeTurnByThread[selectedThreadId])
    : false;

  const repoGroups = useMemo(
    () =>
      repos.map((repo) => {
        const list = threadsByRepo[repo.repoId] ?? [];
        const normalizedPath = normalizeRootPath(repo.path);
        const threads = normalizedPath
          ? list.filter(
              (thread) => normalizeRootPath(thread.cwd) === normalizedPath,
            )
          : list;
        return {
          repo,
          threads,
          sessionStatus: sessionStatusByRepo[repo.repoId] ?? "stopped",
        };
      }),
    [repos, sessionStatusByRepo, threadsByRepo],
  );

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  const updateThreadMessages = useCallback(
    (threadId: string, updater: (list: ChatMessage[]) => ChatMessage[]) => {
      setMessagesByThread((prev) => {
        const list = updater(prev[threadId] ?? []);
        return { ...prev, [threadId]: list };
      });
    },
    [],
  );

  const updateThreadDiffs = useCallback(
    (threadId: string, updater: (list: DiffEntry[]) => DiffEntry[]) => {
      setDiffsByThread((prev) => {
        const list = updater(prev[threadId] ?? []);
        return { ...prev, [threadId]: list };
      });
    },
    [],
  );

  const updateThreadFileChanges = useCallback(
    (
      threadId: string,
      updater: (
        map: Record<string, FileChangeEntry>,
      ) => Record<string, FileChangeEntry>,
    ) => {
      setFileChangesByThread((prev) => {
        const map = updater(prev[threadId] ?? {});
        return { ...prev, [threadId]: map };
      });
    },
    [],
  );

  const updateThreadApprovals = useCallback(
    (
      threadId: string,
      updater: (list: ApprovalRequest[]) => ApprovalRequest[],
    ) => {
      setApprovalsByThread((prev) => {
        const list = updater(prev[threadId] ?? []);
        return { ...prev, [threadId]: list };
      });
    },
    [],
  );

  const setThreadMessages = useCallback(
    (threadId: string, list: ChatMessage[]) => {
      setMessagesByThread((prev) => ({ ...prev, [threadId]: list }));
    },
    [],
  );

  const wsHandlers = useMemo(
    () =>
      createWsEventHandlers({
        getSelectedThreadId: () => selectedThreadIdRef.current,
        updateMessages: updateThreadMessages,
        updateDiffs: updateThreadDiffs,
        updateFileChanges: updateThreadFileChanges,
        updateApprovals: updateThreadApprovals,
        setActiveTurn: (threadId: string, turnId: string | null) => {
          setActiveTurnByThread((prev) => ({ ...prev, [threadId]: turnId }));
        },
      }),
    [
      updateThreadMessages,
      updateThreadDiffs,
      updateThreadFileChanges,
      updateThreadApprovals,
    ],
  );

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

  useEffect(() => {
    const missing = repos.filter(
      (repo) =>
        repo.repoId !== selectedRepoId &&
        !Object.prototype.hasOwnProperty.call(threadsByRepo, repo.repoId),
    );
    if (missing.length === 0) return;
    void (async () => {
      await Promise.all(
        missing.map(async (repo) => {
          try {
            const list = await api.listThreads(repo.repoId);
            setThreadsByRepo((prev) => ({ ...prev, [repo.repoId]: list }));
          } catch (error) {
            console.warn("Failed to load threads", repo.repoId, error);
          }
        }),
      );
    })();
  }, [repos, selectedRepoId, threadsByRepo]);

  const sendWs = useCallback((message: WsOutboundMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

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
          wsHandlers.handleAppServerNotification(
            message.payload.repoId,
            message.payload.message,
          );
          break;
        case "app_server_request":
          wsHandlers.handleAppServerRequest(
            message.payload.repoId,
            message.payload.message,
          );
          break;
        default:
          break;
      }
    },
    [wsHandlers],
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
        const pendingSelection = pendingThreadSelectionRef.current;
        const pendingThreadId =
          pendingSelection && pendingSelection.repoId === selectedRepoId
            ? list.find((thread) => thread.threadId === pendingSelection.threadId)
                ?.threadId ?? null
            : null;
        if (pendingSelection && pendingSelection.repoId === selectedRepoId) {
          pendingThreadSelectionRef.current = null;
        }
        const preferred =
          pendingThreadId ?? lastOpenedThreadId ?? filtered[0]?.threadId ?? null;
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
  }, [
    lastOpenedThreadId,
    normalizedRepoPath,
    selectedRepoId,
    setThreadMessages,
  ]);

  const handleApprove = useCallback(
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
      const threadId = request.threadId ?? selectedThreadIdRef.current;
      if (!threadId) return;
      updateThreadApprovals(threadId, (list) =>
        list.filter((item) => item.rpcId !== request.rpcId),
      );
    },
    [sendWs, updateThreadApprovals],
  );

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!selectedRepoId || !selectedThreadId || !text) return;
    const pendingId = `pending-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    updateThreadMessages(selectedThreadId, (list) => [
      ...list,
      {
        id: pendingId,
        role: "user",
        text,
        createdAt: Date.now(),
        pending: true,
      },
    ]);
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
    async (repoId: string, threadId: string) => {
      if (!repoId) return;
      if (repoId !== selectedRepoId) {
        pendingThreadSelectionRef.current = { repoId, threadId };
        setSelectedRepoId(repoId);
        return;
      }
      pendingThreadSelectionRef.current = null;
      setSelectedThreadId(threadId);
      try {
        const resumeResult = await api.resumeThread(repoId, threadId);
        const resumeMessages = buildMessagesFromResume(threadId, resumeResult);
        setThreadMessages(threadId, resumeMessages);
        await api.updateRepo(repoId, { lastOpenedThreadId: threadId });
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to resume thread",
        );
      }
    },
    [selectedRepoId, setThreadMessages],
  );

  const handleAddRepo = useCallback(async () => {
    try {
      const path = await api.pickRepoPath();
      if (!path) return;
      const name = extractRepoName(path);
      if (!name) {
        setErrorMessage("Failed to derive repository name");
        return;
      }
      const repo = await api.createRepo(name, path);
      setRepos((prev) => [...prev, repo]);
      setSelectedRepoId(repo.repoId);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : "Failed to add repo",
      );
    }
  }, []);

  const selectRepo = useCallback((repoId: string | null) => {
    pendingThreadSelectionRef.current = null;
    setSelectedRepoId(repoId);
  }, []);

  return {
    repos,
    repoGroups,
    selectedRepoId,
    selectedRepo,
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
    setInputText,
    handleAddRepo,
    handleCreateThread,
    handleSelectThread,
    handleApprove,
    handleSend,
  };
};
