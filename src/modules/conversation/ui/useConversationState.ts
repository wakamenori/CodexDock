import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError, api } from "../../../api";
import { extractRepoName } from "../../../shared/paths";
import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  JsonValue,
  Repo,
  SessionStatus,
  ThreadStatusFlags,
  ThreadSummary,
  ThreadUiStatus,
  WsInboundMessage,
  WsOutboundMessage,
} from "../../../types";
import {
  buildApprovalMessageText,
  extractCommandTextFromParams,
  extractCwdFromParams,
  outcomeFromDecision,
} from "../domain/approval";
import {
  buildMessagesFromResume,
  createRequestId,
  deriveReviewingFromResume,
  normalizeRootPath,
} from "../domain/parsers";
import { createWsEventHandlers } from "../infra/wsHandlers";

export type UseAppStateResult = {
  repos: Repo[];
  repoGroups: {
    repo: Repo;
    threads: ThreadSummary[];
    sessionStatus: SessionStatus;
  }[];
  threadUiStatusByThread: Record<string, ThreadUiStatus>;
  selectedRepoId: string | null;
  selectedRepo: Repo | null;
  selectedThreadId: string | null;
  wsConnected: boolean;
  running: boolean;
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

const summarizeThreadsForLog = (threads: ThreadSummary[]) =>
  threads.map((thread) => ({
    threadId: thread.threadId,
    createdAt: thread.createdAt ?? null,
    updatedAt: thread.updatedAt ?? null,
    previewLength: thread.preview?.length ?? 0,
  }));

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
  const [, setActiveTurnByThread] = useState<Record<string, string | null>>({});
  const [threadStatusByThread, setThreadStatusByThread] = useState<
    Record<string, ThreadStatusFlags>
  >({});
  const [inputText, setInputText] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
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
    ? Boolean(threadStatusByThread[selectedThreadId]?.processing)
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

  const threadUiStatusByThread = useMemo(() => {
    const threadIds = new Set<string>([
      ...Object.keys(threadStatusByThread),
      ...Object.keys(approvalsByThread),
    ]);
    const statusMap: Record<string, ThreadUiStatus> = {};
    for (const threadId of threadIds) {
      const status = threadStatusByThread[threadId] ?? {
        processing: false,
        reviewing: false,
        unread: false,
      };
      const approvals = approvalsByThread[threadId] ?? [];
      if (approvals.length > 0) {
        statusMap[threadId] = "approval";
        continue;
      }
      if (status.reviewing) {
        statusMap[threadId] = "reviewing";
        continue;
      }
      if (status.processing) {
        statusMap[threadId] = "processing";
        continue;
      }
      if (status.unread) {
        statusMap[threadId] = "unread";
        continue;
      }
      statusMap[threadId] = "ready";
    }
    return statusMap;
  }, [approvalsByThread, threadStatusByThread]);

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

  const updateThreadStatus = useCallback(
    (
      threadId: string,
      updater: (status: ThreadStatusFlags) => ThreadStatusFlags,
    ) => {
      setThreadStatusByThread((prev) => {
        const current = prev[threadId] ?? {
          processing: false,
          reviewing: false,
          unread: false,
        };
        const next = updater(current);
        return { ...prev, [threadId]: next };
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
        updateThreadStatus,
      }),
    [
      updateThreadMessages,
      updateThreadDiffs,
      updateThreadFileChanges,
      updateThreadApprovals,
      updateThreadStatus,
    ],
  );

  useEffect(() => {
    if (!selectedThreadId) return;
    updateThreadStatus(selectedThreadId, (status) => ({
      ...status,
      unread: false,
    }));
  }, [selectedThreadId, updateThreadStatus]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.listRepos();
        setRepos(data);
        if (data.length > 0) {
          setSelectedRepoId((current) => current ?? data[0].repoId);
        }
      } catch (error) {
        toast.error(
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
          toast.error(message.payload.error.message);
          break;
        case "session_status":
          setSessionStatusByRepo((prev) => ({
            ...prev,
            [message.payload.repoId]: message.payload.status,
          }));
          break;
        case "thread_list_updated":
          console.info("thread_list_updated", {
            repoId: message.payload.repoId,
            threadCount: message.payload.threads.length,
            threads: summarizeThreadsForLog(message.payload.threads),
          });
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
        console.info("thread_list_http", {
          repoId: selectedRepoId,
          threadCount: list.length,
          threads: summarizeThreadsForLog(list),
        });
        setThreadsByRepo((prev) => ({ ...prev, [selectedRepoId]: list }));
        const filtered = normalizedRepoPath
          ? list.filter(
              (thread) => normalizeRootPath(thread.cwd) === normalizedRepoPath,
            )
          : list;
        const pendingSelection = pendingThreadSelectionRef.current;
        const pendingThreadId =
          pendingSelection && pendingSelection.repoId === selectedRepoId
            ? (list.find(
                (thread) => thread.threadId === pendingSelection.threadId,
              )?.threadId ?? null)
            : null;
        if (pendingSelection && pendingSelection.repoId === selectedRepoId) {
          pendingThreadSelectionRef.current = null;
        }
        const preferred =
          pendingThreadId ??
          lastOpenedThreadId ??
          filtered[0]?.threadId ??
          null;
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
          updateThreadStatus(preferred, (status) => ({
            ...status,
            reviewing: deriveReviewingFromResume(resumeResult),
            processing: false,
          }));
          await api.updateRepo(selectedRepoId, {
            lastOpenedThreadId: preferred,
          });
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to start session",
        );
      }
    })();
  }, [
    lastOpenedThreadId,
    normalizedRepoPath,
    selectedRepoId,
    setThreadMessages,
    updateThreadStatus,
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
      const isCommandApproval =
        request.method === "item/commandExecution/requestApproval";
      const isFileChangeApproval =
        request.method === "item/fileChange/requestApproval";
      if (isCommandApproval || isFileChangeApproval) {
        const changes =
          isFileChangeApproval && request.itemId
            ? (fileChangesByThread[threadId]?.[request.itemId]?.changes ?? [])
            : [];
        const commandText = isCommandApproval
          ? extractCommandTextFromParams(request.params)
          : null;
        const cwd = isCommandApproval
          ? extractCwdFromParams(request.params)
          : null;
        const outcome = outcomeFromDecision(decision);
        const text = buildApprovalMessageText({
          kind: isCommandApproval ? "command" : "fileChange",
          outcome,
          commandText,
          cwd,
          fileChanges: changes,
          repoRoot: selectedRepo?.path ?? null,
        });
        updateThreadMessages(threadId, (list) => [
          ...list,
          {
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
        ]);
      }
      updateThreadApprovals(threadId, (list) =>
        list.filter((item) => item.rpcId !== request.rpcId),
      );
    },
    [
      fileChangesByThread,
      selectedRepo,
      sendWs,
      updateThreadApprovals,
      updateThreadMessages,
    ],
  );

  const handleSend = useCallback(async () => {
    const originalText = inputText;
    const text = originalText.trim();
    if (!selectedRepoId || !selectedThreadId || !text) return;
    updateThreadStatus(selectedThreadId, (status) => ({
      ...status,
      processing: true,
    }));
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
    setInputText("");
    try {
      const turn = await api.startTurn(selectedRepoId, selectedThreadId, [
        { type: "text", text },
      ]);
      setActiveTurnByThread((prev) => ({
        ...prev,
        [selectedThreadId]: turn.turnId,
      }));
    } catch (error) {
      updateThreadMessages(selectedThreadId, (list) =>
        list.filter((item) => item.id !== pendingId),
      );
      updateThreadStatus(selectedThreadId, (status) => ({
        ...status,
        processing: false,
      }));
      setInputText(originalText);
      toast.error(error instanceof Error ? error.message : "Turn failed");
    }
  }, [
    inputText,
    selectedRepoId,
    selectedThreadId,
    updateThreadMessages,
    updateThreadStatus,
  ]);

  const handleCreateThread = useCallback(
    async (targetRepoId?: string | null) => {
      const repoId = targetRepoId ?? selectedRepoId;
      if (!repoId) return;
      try {
        const threadId = await api.createThread(repoId);
        if (repoId === selectedRepoId) {
          await api.resumeThread(repoId, threadId);
          setSelectedThreadId(threadId);
          await api.updateRepo(repoId, { lastOpenedThreadId: threadId });
          const list = await api.listThreads(repoId);
          setThreadsByRepo((prev) => ({ ...prev, [repoId]: list }));
          return;
        }
        pendingThreadSelectionRef.current = { repoId, threadId };
        setSelectedRepoId(repoId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create thread",
        );
      }
    },
    [selectedRepoId],
  );

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
        updateThreadStatus(threadId, (status) => ({
          ...status,
          reviewing: deriveReviewingFromResume(resumeResult),
          processing: false,
        }));
        await api.updateRepo(repoId, { lastOpenedThreadId: threadId });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to resume thread",
        );
      }
    },
    [selectedRepoId, setThreadMessages, updateThreadStatus],
  );

  const handleAddRepo = useCallback(async () => {
    try {
      const path = await api.pickRepoPath();
      if (!path) return;
      const name = extractRepoName(path);
      if (!name) {
        toast.error("Failed to derive repository name");
        return;
      }
      const repo = await api.createRepo(name, path);
      setRepos((prev) => [...prev, repo]);
      setSelectedRepoId(repo.repoId);
    } catch (error) {
      toast.error(
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
    threadUiStatusByThread,
    selectedRepoId,
    selectedRepo,
    selectedThreadId,
    wsConnected,
    running,
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
