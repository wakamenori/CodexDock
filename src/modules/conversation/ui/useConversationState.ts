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
  PermissionMode,
  Repo,
  ReviewTarget,
  ReviewTargetType,
  SessionStatus,
  ThreadStatusFlags,
  ThreadSummary,
  ThreadUiStatus,
  ToolTimelineItem,
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
  buildMessagesFromResume,
  buildToolItemsFromResume,
  createRequestId,
  deriveReviewingFromResume,
  normalizeRootPath,
  parseFileChangeEntries,
  parseItemId,
  parseItemRecord,
  parseThreadId,
} from "../domain/parsers";
import {
  buildPermissionOptions,
  normalizePermissionMode,
  PERMISSION_MODE_OPTIONS,
} from "../domain/permissionMode";
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
  activeTurnId: string | null;
  messages: ChatMessage[];
  toolItems: ToolTimelineItem[];
  diffs: DiffEntry[];
  fileChanges: Record<string, FileChangeEntry>;
  approvals: ApprovalRequest[];
  inputText: string;
  reviewTargetType: ReviewTargetType;
  reviewBaseBranch: string;
  reviewCommitSha: string;
  reviewCustomInstructions: string;
  selectedModel: string | null;
  availableModels: string[] | undefined;
  permissionMode: PermissionMode;
  selectRepo: (repoId: string | null) => void;
  setInputText: (value: string) => void;
  setReviewTargetType: (value: ReviewTargetType) => void;
  setReviewBaseBranch: (value: string) => void;
  setReviewCommitSha: (value: string) => void;
  setReviewCustomInstructions: (value: string) => void;
  handleAddRepo: () => Promise<void>;
  handleCreateThread: (targetRepoId?: string | null) => Promise<void>;
  handleSelectThread: (repoId: string, threadId: string) => Promise<void>;
  handleModelChange: (model: string | null) => void;
  handlePermissionModeChange: (mode: PermissionMode) => void;
  handleApprove: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
  handleSend: () => Promise<void>;
  handleReviewStart: () => Promise<void>;
  handleStop: () => Promise<void>;
};

const summarizeThreadsForLog = (threads: ThreadSummary[]) =>
  threads.map((thread) => ({
    threadId: thread.threadId,
    createdAt: thread.createdAt ?? null,
    updatedAt: thread.updatedAt ?? null,
    previewLength: thread.preview?.length ?? 0,
  }));

const NEW_THREAD_PREVIEW = "New thread";

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

const resolveSelectedModel = ({
  storedModel,
  defaultModel,
  availableModels,
  settingsLoaded,
}: {
  storedModel: string | null;
  defaultModel: string | null;
  availableModels: string[] | undefined;
  settingsLoaded: boolean;
}): string | null => {
  if (!settingsLoaded) return storedModel;
  if (!availableModels) return storedModel;
  if (availableModels.length === 0) return null;
  if (storedModel && availableModels.includes(storedModel)) return storedModel;
  if (defaultModel && availableModels.includes(defaultModel))
    return defaultModel;
  return availableModels[0] ?? null;
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
  const [toolItemsByThread, setToolItemsByThread] = useState<
    Record<string, Record<string, ToolTimelineItem>>
  >({});
  const [approvalsByThread, setApprovalsByThread] = useState<
    Record<string, ApprovalRequest[]>
  >({});
  const [activeTurnByThread, setActiveTurnByThread] = useState<
    Record<string, string | null>
  >({});
  const [threadStatusByThread, setThreadStatusByThread] = useState<
    Record<string, ThreadStatusFlags>
  >({});
  const [availableModelsByRepo, setAvailableModelsByRepo] = useState<
    Record<string, string[]>
  >({});
  const [storedModel, setStoredModel] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelSettingsLoaded, setModelSettingsLoaded] = useState(false);
  const [permissionMode, setPermissionMode] =
    useState<PermissionMode>("ReadOnly");
  const [inputText, setInputText] = useState("");
  const [reviewTargetType, setReviewTargetType] =
    useState<ReviewTargetType>("uncommittedChanges");
  const [reviewBaseBranch, setReviewBaseBranch] = useState("");
  const [reviewCommitSha, setReviewCommitSha] = useState("");
  const [reviewCustomInstructions, setReviewCustomInstructions] = useState("");
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
  const permissionModeTouchedRef = useRef(false);
  const permissionModeByThreadRef = useRef<Record<string, PermissionMode>>({});
  const autoApprovedItemsByThreadRef = useRef<Record<string, Set<string>>>({});
  const permissionModeRef = useRef<PermissionMode>("ReadOnly");
  const selectedRepoPathRef = useRef<string | null>(null);
  const repoPathByIdRef = useRef<Record<string, string>>({});

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
  const toolItems = selectedThreadId
    ? Object.values(toolItemsByThread[selectedThreadId] ?? {})
    : [];
  const approvals = selectedThreadId
    ? (approvalsByThread[selectedThreadId] ?? [])
    : [];
  const activeTurnId = selectedThreadId
    ? (activeTurnByThread[selectedThreadId] ?? null)
    : null;
  const running = selectedThreadId
    ? Boolean(threadStatusByThread[selectedThreadId]?.processing)
    : false;
  const availableModels = selectedRepoId
    ? availableModelsByRepo[selectedRepoId]
    : undefined;
  const selectedModel = useMemo(
    () =>
      resolveSelectedModel({
        storedModel,
        defaultModel,
        availableModels,
        settingsLoaded: modelSettingsLoaded,
      }),
    [availableModels, defaultModel, modelSettingsLoaded, storedModel],
  );

  const handlePermissionModeChange = useCallback((mode: PermissionMode) => {
    permissionModeTouchedRef.current = true;
    if (PERMISSION_MODE_OPTIONS.includes(mode)) {
      setPermissionMode(mode);
    }
  }, []);

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

  const updateThreadPreview = useCallback(
    (repoId: string, threadId: string, preview: string) => {
      if (!preview) return;
      setThreadsByRepo((prev) => {
        const list = prev[repoId] ?? [];
        let updated = false;
        const next = list.map((thread) => {
          if (thread.threadId !== threadId) return thread;
          if (thread.preview?.trim() !== NEW_THREAD_PREVIEW) return thread;
          updated = true;
          return { ...thread, preview };
        });
        if (!updated) return prev;
        return { ...prev, [repoId]: next };
      });
      const optimisticRepo = optimisticThreadsRef.current[repoId];
      const optimisticThread = optimisticRepo?.[threadId];
      if (optimisticThread?.preview?.trim() === NEW_THREAD_PREVIEW) {
        optimisticRepo[threadId] = { ...optimisticThread, preview };
      }
    },
    [],
  );

  const updateThreadLastMessageAt = useCallback(
    (repoId: string, threadId: string, lastMessageAt: string) => {
      if (!lastMessageAt) return;
      setThreadsByRepo((prev) => {
        const list = prev[repoId] ?? [];
        let updated = false;
        const next = list.map((thread) => {
          if (thread.threadId !== threadId) return thread;
          updated = true;
          return { ...thread, lastMessageAt };
        });
        if (!updated) return prev;
        return { ...prev, [repoId]: next };
      });
      const optimisticRepo = optimisticThreadsRef.current[repoId];
      const optimisticThread = optimisticRepo?.[threadId];
      if (optimisticThread) {
        optimisticRepo[threadId] = { ...optimisticThread, lastMessageAt };
      }
    },
    [],
  );

  const rollbackThreadLastMessageAt = useCallback(
    (
      repoId: string,
      threadId: string,
      optimisticTimestamp: string,
      previousTimestamp: string | null,
    ) => {
      setThreadsByRepo((prev) => {
        const list = prev[repoId] ?? [];
        let updated = false;
        const next = list.map((thread) => {
          if (thread.threadId !== threadId) return thread;
          if (thread.lastMessageAt !== optimisticTimestamp) return thread;
          updated = true;
          if (!previousTimestamp) {
            const { lastMessageAt: _ignored, ...rest } = thread;
            return rest;
          }
          return { ...thread, lastMessageAt: previousTimestamp };
        });
        if (!updated) return prev;
        return { ...prev, [repoId]: next };
      });
      const optimisticRepo = optimisticThreadsRef.current[repoId];
      const optimisticThread = optimisticRepo?.[threadId];
      if (optimisticThread?.lastMessageAt === optimisticTimestamp) {
        if (previousTimestamp) {
          optimisticRepo[threadId] = {
            ...optimisticThread,
            lastMessageAt: previousTimestamp,
          };
        } else {
          const { lastMessageAt: _ignored, ...rest } = optimisticThread;
          optimisticRepo[threadId] = rest;
        }
      }
    },
    [],
  );

  const rollbackThreadPreview = useCallback(
    (
      repoId: string,
      threadId: string,
      optimisticPreview: string,
      previousPreview: string,
    ) => {
      if (!previousPreview) return;
      setThreadsByRepo((prev) => {
        const list = prev[repoId] ?? [];
        let updated = false;
        const next = list.map((thread) => {
          if (thread.threadId !== threadId) return thread;
          if (thread.preview !== optimisticPreview) return thread;
          updated = true;
          return { ...thread, preview: previousPreview };
        });
        if (!updated) return prev;
        return { ...prev, [repoId]: next };
      });
      const optimisticRepo = optimisticThreadsRef.current[repoId];
      const optimisticThread = optimisticRepo?.[threadId];
      if (optimisticThread?.preview === optimisticPreview) {
        optimisticRepo[threadId] = {
          ...optimisticThread,
          preview: previousPreview,
        };
      }
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

  useEffect(() => {
    permissionModeRef.current = permissionMode;
  }, [permissionMode]);

  useEffect(() => {
    selectedRepoPathRef.current = selectedRepo?.path ?? null;
  }, [selectedRepo?.path]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const repo of repos) {
      if (repo.path) {
        next[repo.repoId] = repo.path;
      }
    }
    repoPathByIdRef.current = next;
  }, [repos]);

  const updateThreadMessages = useCallback(
    (threadId: string, updater: (list: ChatMessage[]) => ChatMessage[]) => {
      setMessagesByThread((prev) => {
        const list = updater(prev[threadId] ?? []);
        return { ...prev, [threadId]: list };
      });
    },
    [],
  );

  const markAutoApproved = useCallback((threadId: string, itemId: string) => {
    const map = autoApprovedItemsByThreadRef.current;
    const set = map[threadId] ?? new Set<string>();
    if (set.has(itemId)) return false;
    set.add(itemId);
    map[threadId] = set;
    return true;
  }, []);

  const appendAutoApproval = useCallback(
    (repoId: string, message: { method: string; params?: JsonValue }) => {
      if (message.method !== "item/completed") return;
      const item = parseItemRecord(message.params);
      if (!item) return;
      const itemType = item.type;
      if (itemType !== "commandExecution" && itemType !== "fileChange") return;
      const threadId =
        parseThreadId(message.params) ?? selectedThreadIdRef.current;
      if (!threadId) return;
      const mode =
        permissionModeByThreadRef.current[threadId] ??
        permissionModeRef.current;
      if (mode !== "FullAccess") return;
      const itemId = parseItemId(message.params, `${itemType}-${Date.now()}`);
      if (!markAutoApproved(threadId, itemId)) return;
      const kind = itemType === "commandExecution" ? "command" : "fileChange";
      const status = typeof item.status === "string" ? item.status : null;
      const outcome = outcomeFromStatus(status) ?? "approved";
      const commandText =
        kind === "command" ? extractCommandTextFromItem(item) : null;
      const cwd = kind === "command" ? extractCwdFromItem(item) : null;
      const fileChanges =
        kind === "fileChange" ? parseFileChangeEntries(item) : null;
      const repoRoot =
        repoPathByIdRef.current[repoId] ?? selectedRepoPathRef.current;
      const text = buildApprovalMessageText({
        kind,
        outcome,
        commandText,
        cwd,
        fileChanges,
        repoRoot,
      });
      updateThreadMessages(threadId, (list) => [
        ...list,
        {
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
      ]);
    },
    [markAutoApproved, updateThreadMessages],
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

  const updateThreadToolItems = useCallback(
    (
      threadId: string,
      updater: (
        map: Record<string, ToolTimelineItem>,
      ) => Record<string, ToolTimelineItem>,
    ) => {
      setToolItemsByThread((prev) => {
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

  const setThreadToolItems = useCallback(
    (threadId: string, list: ToolTimelineItem[]) => {
      const map = Object.fromEntries(list.map((item) => [item.itemId, item]));
      setToolItemsByThread((prev) => ({ ...prev, [threadId]: map }));
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
        updateToolItems: updateThreadToolItems,
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
      updateThreadToolItems,
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
    void (async () => {
      try {
        const settings = await api.getModelSettings();
        setStoredModel(settings.storedModel ?? null);
        setDefaultModel(settings.defaultModel ?? null);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load model",
        );
      } finally {
        setModelSettingsLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await api.getPermissionModeSettings();
        if (permissionModeTouchedRef.current) return;
        setPermissionMode(normalizePermissionMode(settings.defaultMode));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load permission mode",
        );
      }
    })();
  }, []);

  useEffect(() => {
    const missing = repos.filter(
      (repo) =>
        repo.repoId !== selectedRepoId &&
        !Object.hasOwn(threadsByRepo, repo.repoId),
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
          next[selectedRepoId] = models;
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
          appendAutoApproval(message.payload.repoId, message.payload.message);
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
    [appendAutoApproval, applyThreadList, wsHandlers],
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
          const baseTime = Date.now();
          const resumeMessages = buildMessagesFromResume(
            preferred,
            resumeResult,
            baseTime,
          );
          const resumeToolItems = buildToolItemsFromResume(
            preferred,
            resumeResult,
            baseTime,
          );
          const reviewing = deriveReviewingFromResume(resumeResult);
          setThreadMessages(preferred, resumeMessages);
          setThreadToolItems(preferred, resumeToolItems);
          updateThreadStatus(preferred, (status) => ({
            ...status,
            reviewing,
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
    setThreadToolItems,
    updateThreadStatus,
  ]);

  const handleModelChange = useCallback(
    (model: string | null) => {
      const previous = storedModel;
      setStoredModel(model);
      void (async () => {
        try {
          const stored = await api.updateModelSetting(model);
          setStoredModel(stored ?? null);
        } catch (error) {
          setStoredModel(previous ?? null);
          toast.error(
            error instanceof Error ? error.message : "Failed to update model",
          );
        }
      })();
    },
    [storedModel],
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
    const modelsLoaded = availableModels !== undefined;
    const modelsReady = modelsLoaded && availableModels.length > 0;
    if (!modelsReady || !selectedModel) {
      toast.error("Model is not set");
      return;
    }
    const modelToSend = selectedModel;
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
    const nowIso = new Date().toISOString();
    const currentPreview =
      threadsByRepo[selectedRepoId]?.find(
        (thread) => thread.threadId === selectedThreadId,
      )?.preview ?? null;
    const previousLastMessageAt =
      threadsByRepo[selectedRepoId]?.find(
        (thread) => thread.threadId === selectedThreadId,
      )?.lastMessageAt ?? null;
    updateThreadLastMessageAt(selectedRepoId, selectedThreadId, nowIso);
    const shouldUpdatePreview = currentPreview?.trim() === NEW_THREAD_PREVIEW;
    if (shouldUpdatePreview) {
      updateThreadPreview(selectedRepoId, selectedThreadId, text);
    }
    try {
      permissionModeByThreadRef.current[selectedThreadId] = permissionMode;
      const permissionOptions = buildPermissionOptions(
        permissionMode,
        selectedRepo?.path,
      );
      const turn = await api.startTurn(
        selectedRepoId,
        selectedThreadId,
        [{ type: "text", text }],
        { model: modelToSend, ...permissionOptions },
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
      if (shouldUpdatePreview && currentPreview) {
        rollbackThreadPreview(
          selectedRepoId,
          selectedThreadId,
          text,
          currentPreview,
        );
      }
      rollbackThreadLastMessageAt(
        selectedRepoId,
        selectedThreadId,
        nowIso,
        previousLastMessageAt,
      );
      setInputText(originalText);
      toast.error(error instanceof Error ? error.message : "Turn failed");
    }
  }, [
    inputText,
    selectedRepoId,
    selectedThreadId,
    selectedModel,
    availableModels,
    permissionMode,
    selectedRepo?.path,
    threadsByRepo,
    updateThreadMessages,
    updateThreadLastMessageAt,
    rollbackThreadLastMessageAt,
    updateThreadPreview,
    rollbackThreadPreview,
    updateThreadStatus,
  ]);

  const buildReviewTarget = useCallback((): ReviewTarget | null => {
    if (reviewTargetType === "uncommittedChanges") {
      return { type: "uncommittedChanges" };
    }
    if (reviewTargetType === "baseBranch") {
      const branch = reviewBaseBranch.trim();
      if (!branch) return null;
      return { type: "baseBranch", branch };
    }
    if (reviewTargetType === "commit") {
      const sha = reviewCommitSha.trim();
      if (!sha) return null;
      return { type: "commit", sha };
    }
    if (reviewTargetType === "custom") {
      const instructions = reviewCustomInstructions.trim();
      if (!instructions) return null;
      return { type: "custom", instructions };
    }
    return null;
  }, [
    reviewBaseBranch,
    reviewCommitSha,
    reviewCustomInstructions,
    reviewTargetType,
  ]);

  const handleReviewStart = useCallback(async () => {
    if (!selectedRepoId || !selectedThreadId) return;
    if (running) return;
    const target = buildReviewTarget();
    if (!target) {
      toast.error("Review target is not set");
      return;
    }
    updateThreadStatus(selectedThreadId, (status) => ({
      ...status,
      processing: true,
    }));
    try {
      const result = await api.startReview(
        selectedRepoId,
        selectedThreadId,
        target,
        "inline",
      );
      setActiveTurnByThread((prev) => ({
        ...prev,
        [selectedThreadId]: result.turnId,
      }));
    } catch (error) {
      updateThreadStatus(selectedThreadId, (status) => ({
        ...status,
        processing: false,
      }));
      toast.error(error instanceof Error ? error.message : "Review failed");
    }
  }, [
    buildReviewTarget,
    running,
    selectedRepoId,
    selectedThreadId,
    updateThreadStatus,
  ]);

  const handleStop = useCallback(async () => {
    if (!selectedRepoId || !selectedThreadId) return;
    const turnId = activeTurnByThread[selectedThreadId];
    if (!turnId) return;
    try {
      await api.cancelTurn(selectedRepoId, turnId, selectedThreadId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancel failed");
    }
  }, [activeTurnByThread, selectedRepoId, selectedThreadId]);

  const handleCreateThread = useCallback(
    async (targetRepoId?: string | null) => {
      const repoId = targetRepoId ?? selectedRepoId;
      if (!repoId) return;
      try {
        let models = availableModelsByRepo[repoId];
        if (models === undefined) {
          try {
            const result = await api.listModels(repoId);
            models = extractModelIds(result);
            setAvailableModelsByRepo((prev) => ({
              ...prev,
              [repoId]: models ?? [],
            }));
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Failed to load models",
            );
            return;
          }
        }
        if (!models || models.length === 0) {
          toast.error("Model is not set");
          return;
        }
        const model = resolveSelectedModel({
          storedModel,
          defaultModel,
          availableModels: models,
          settingsLoaded: modelSettingsLoaded,
        });
        if (!model) {
          toast.error("Model is not set");
          return;
        }
        const threadId = await api.createThread(repoId, model ?? undefined);
        const repo = repos.find((item) => item.repoId === repoId) ?? null;
        const now = new Date().toISOString();
        addOptimisticThread(repoId, {
          threadId,
          cwd: repo?.path,
          preview: NEW_THREAD_PREVIEW,
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
      availableModelsByRepo,
      defaultModel,
      modelSettingsLoaded,
      repos,
      storedModel,
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
        const baseTime = Date.now();
        const resumeMessages = buildMessagesFromResume(
          threadId,
          resumeResult,
          baseTime,
        );
        const resumeToolItems = buildToolItemsFromResume(
          threadId,
          resumeResult,
          baseTime,
        );
        const reviewing = deriveReviewingFromResume(resumeResult);
        setThreadMessages(threadId, resumeMessages);
        setThreadToolItems(threadId, resumeToolItems);
        updateThreadStatus(threadId, (status) => ({
          ...status,
          reviewing,
          processing: false,
        }));
        await api.updateRepo(repoId, { lastOpenedThreadId: threadId });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to resume thread",
        );
      }
    },
    [selectedRepoId, setThreadMessages, setThreadToolItems, updateThreadStatus],
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
    activeTurnId,
    messages,
    diffs,
    fileChanges,
    toolItems,
    approvals,
    inputText,
    reviewTargetType,
    reviewBaseBranch,
    reviewCommitSha,
    reviewCustomInstructions,
    selectedModel,
    availableModels,
    permissionMode,
    selectRepo,
    setInputText,
    setReviewTargetType,
    setReviewBaseBranch,
    setReviewCommitSha,
    setReviewCustomInstructions,
    handleAddRepo,
    handleCreateThread,
    handleSelectThread,
    handleModelChange,
    handlePermissionModeChange,
    handleApprove,
    handleSend,
    handleReviewStart,
    handleStop,
  };
};
