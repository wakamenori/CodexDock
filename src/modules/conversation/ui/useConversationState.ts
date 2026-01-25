import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError, api } from "../../../api";
import { extractRepoName } from "../../../shared/paths";
import { asRecord } from "../../../shared/records";
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
  selectedModel: string | null;
  availableModels: string[] | undefined;
  selectRepo: (repoId: string | null) => void;
  setInputText: (value: string) => void;
  handleAddRepo: () => Promise<void>;
  handleCreateThread: () => Promise<void>;
  handleSelectThread: (repoId: string, threadId: string) => Promise<void>;
  handleModelChange: (model: string | null) => void;
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

const DEFAULT_MODEL = "gpt-5.2-codex";

const getArrayValue = (
  record: Record<string, unknown> | undefined,
  key: string,
): unknown[] | undefined => {
  if (!record) return undefined;
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
};

const getStringValue = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const extractModelIdsFromArray = (items: unknown[]) => {
  const ids: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    const record = asRecord(item);
    const id =
      getStringValue(record, "id") ??
      getStringValue(record, "name") ??
      getStringValue(record, "model") ??
      getStringValue(record, "value");
    if (id) ids.push(id);
  }
  return ids;
};

const extractModelIds = (payload: unknown): string[] => {
  if (Array.isArray(payload)) {
    return extractModelIdsFromArray(payload);
  }
  const record = asRecord(payload);
  if (!record) return [];
  const nested = record.result;
  if (nested) {
    const nestedIds = extractModelIds(nested);
    if (nestedIds.length > 0) return nestedIds;
  }
  const candidates = [
    getArrayValue(record, "models"),
    getArrayValue(record, "data"),
    getArrayValue(record, "items"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const ids = extractModelIdsFromArray(candidate);
    if (ids.length > 0) return ids;
  }
  return [];
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
  const [, setActiveTurnByThread] = useState<Record<string, string | null>>({});
  const [threadStatusByThread, setThreadStatusByThread] = useState<
    Record<string, ThreadStatusFlags>
  >({});
  const [availableModelsByRepo, setAvailableModelsByRepo] = useState<
    Record<string, string[]>
  >({});
  const [modelByThread, setModelByThread] = useState<
    Record<string, string | null>
  >({});
  const [inputText, setInputText] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRepoRef = useRef<Set<string>>(new Set());
  const selectedThreadIdRef = useRef<string | null>(null);
  const pendingThreadSelectionRef = useRef<{
    repoId: string;
    threadId: string;
  } | null>(null);
  const optimisticThreadsRef = useRef<
    Record<string, Record<string, ThreadSummary>>
  >({});

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
  const selectedModel = selectedThreadId
    ? (modelByThread[selectedThreadId] ?? null)
    : null;
  const availableModels = selectedRepoId
    ? availableModelsByRepo[selectedRepoId]
    : undefined;

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

  const addOptimisticThread = useCallback(
    (repoId: string, thread: ThreadSummary) => {
      const repoThreads = optimisticThreadsRef.current[repoId] ?? {};
      optimisticThreadsRef.current[repoId] = {
        ...repoThreads,
        [thread.threadId]: thread,
      };
      setThreadsByRepo((prev) => {
        const list = prev[repoId] ?? [];
        if (list.some((item) => item.threadId === thread.threadId)) {
          return prev;
        }
        return { ...prev, [repoId]: [...list, thread] };
      });
    },
    [],
  );

  const mergeOptimisticThreads = useCallback(
    (repoId: string, threads: ThreadSummary[]) => {
      const optimistic = optimisticThreadsRef.current[repoId];
      if (!optimistic || Object.keys(optimistic).length === 0) {
        return threads;
      }
      const known = new Set(threads.map((thread) => thread.threadId));
      const merged = [...threads];
      for (const thread of Object.values(optimistic)) {
        if (!known.has(thread.threadId)) {
          merged.push(thread);
        }
      }
      return merged;
    },
    [],
  );

  const applyThreadList = useCallback(
    (repoId: string, threads: ThreadSummary[]) => {
      const optimistic = optimisticThreadsRef.current[repoId];
      if (optimistic) {
        for (const thread of threads) {
          delete optimistic[thread.threadId];
        }
        if (Object.keys(optimistic).length === 0) {
          delete optimisticThreadsRef.current[repoId];
        }
      }
      const merged = mergeOptimisticThreads(repoId, threads);
      setThreadsByRepo((prev) => ({ ...prev, [repoId]: merged }));
      return merged;
    },
    [mergeOptimisticThreads],
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
            applyThreadList(repo.repoId, list);
          } catch (error) {
            console.warn("Failed to load threads", repo.repoId, error);
          }
        }),
      );
    })();
  }, [applyThreadList, repos, selectedRepoId, threadsByRepo]);

  useEffect(() => {
    if (!selectedRepoId) return;
    void (async () => {
      try {
        const result = await api.listModels(selectedRepoId);
        const models = extractModelIds(result);
        setAvailableModelsByRepo((prev) => {
          const next = { ...prev };
          if (models.length > 0) {
            next[selectedRepoId] = models;
          } else {
            delete next[selectedRepoId];
          }
          return next;
        });
      } catch (error) {
        console.warn("Failed to load models", selectedRepoId, error);
        toast.error(
          error instanceof Error ? error.message : "Failed to load models",
        );
      }
    })();
  }, [selectedRepoId]);

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
          applyThreadList(message.payload.repoId, message.payload.threads);
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
    [applyThreadList, wsHandlers],
  );

  useEffect(() => {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      subscribedRepoRef.current = new Set();
      setWsConnected(true);
    });
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
    if (!wsConnected || !wsRef.current) return;
    const desired = new Set(repos.map((repo) => repo.repoId));
    const subscribed = subscribedRepoRef.current;
    for (const repoId of desired) {
      if (subscribed.has(repoId)) continue;
      sendWs({
        type: "subscribe",
        requestId: createRequestId(),
        payload: { repoId },
      });
    }
    for (const repoId of subscribed) {
      if (desired.has(repoId)) continue;
      sendWs({
        type: "unsubscribe",
        requestId: createRequestId(),
        payload: { repoId },
      });
    }
    subscribedRepoRef.current = desired;
  }, [repos, sendWs, wsConnected]);

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
        const merged = applyThreadList(selectedRepoId, list);
        const filtered = normalizedRepoPath
          ? merged.filter(
              (thread) => normalizeRootPath(thread.cwd) === normalizedRepoPath,
            )
          : merged;
        const pendingSelection = pendingThreadSelectionRef.current;
        const pendingThreadId =
          pendingSelection && pendingSelection.repoId === selectedRepoId
            ? (merged.find(
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
    applyThreadList,
    lastOpenedThreadId,
    normalizedRepoPath,
    selectedRepoId,
    setThreadMessages,
    updateThreadStatus,
  ]);

  useEffect(() => {
    if (!selectedRepoId || !selectedThreadId) return;
    const models = availableModelsByRepo[selectedRepoId];
    if (!models || models.length === 0) return;
    const current = modelByThread[selectedThreadId];
    if (!current) return;
    if (!models.includes(current)) {
      setModelByThread((prev) => ({ ...prev, [selectedThreadId]: null }));
    }
  }, [availableModelsByRepo, modelByThread, selectedRepoId, selectedThreadId]);

  const resolveInitialModel = useCallback(
    (repoId: string) => {
      const models = availableModelsByRepo[repoId];
      if (!models || models.length === 0) return DEFAULT_MODEL;
      return models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : null;
    },
    [availableModelsByRepo],
  );

  const handleModelChange = useCallback(
    (model: string | null) => {
      if (!selectedThreadId) return;
      setModelByThread((prev) => ({ ...prev, [selectedThreadId]: model }));
    },
    [selectedThreadId],
  );

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
    const modelsLoaded =
      availableModels !== undefined && availableModels.length > 0;
    if (!selectedModel && modelsLoaded) {
      toast.error("Model is not set");
      return;
    }
    const modelToSend = selectedModel ?? DEFAULT_MODEL;
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
      const turn = await api.startTurn(
        selectedRepoId,
        selectedThreadId,
        [{ type: "text", text }],
        { model: modelToSend },
      );
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
    selectedModel,
    availableModels,
    updateThreadMessages,
    updateThreadStatus,
  ]);

  const handleCreateThread = useCallback(
    async (targetRepoId?: string | null) => {
      const repoId = targetRepoId ?? selectedRepoId;
      if (!repoId) return;
      try {
        const model = resolveInitialModel(repoId);
        const threadId = await api.createThread(repoId, model ?? undefined);
        setModelByThread((prev) => ({
          ...prev,
          [threadId]: model ?? null,
        }));
        const repo = repos.find((item) => item.repoId === repoId) ?? null;
        const now = new Date().toISOString();
        addOptimisticThread(repoId, {
          threadId,
          cwd: repo?.path,
          preview: "New thread",
          createdAt: now,
          updatedAt: now,
        });
        if (repoId === selectedRepoId) {
          await api.resumeThread(repoId, threadId);
          setSelectedThreadId(threadId);
          await api.updateRepo(repoId, { lastOpenedThreadId: threadId });
          const list = await api.listThreads(repoId);
          applyThreadList(repoId, list);
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
    [
      addOptimisticThread,
      applyThreadList,
      repos,
      resolveInitialModel,
      selectedRepoId,
    ],
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
    selectedModel,
    availableModels,
    selectRepo,
    setInputText,
    handleAddRepo,
    handleCreateThread,
    handleSelectThread,
    handleModelChange,
    handleApprove,
    handleSend,
  };
};
