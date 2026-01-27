import { useCallback } from "react";
import { toast } from "sonner";

import { api } from "../../../api";
import { extractRepoName } from "../../../shared/paths";
import type { ReviewTarget } from "../../../types";
import {
  buildMessagesFromResume,
  deriveReviewingFromResume,
} from "../domain/parsers";
import {
  buildPermissionOptions,
  normalizePermissionMode,
} from "../domain/permissionMode";
import type { ConversationCommands } from "../provider/useConversationCommands";
import {
  selectAvailableModels,
  selectFocusedModel,
  selectFocusedRepo,
  selectFocusedThreadId,
} from "../store/selectors";
import type { ConversationStore } from "../store/store";

const extractModelIdsFromArray = (items: unknown[]) => {
  const ids: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    const record = item as Record<string, unknown>;
    const id =
      (typeof record.id === "string" && record.id) ||
      (typeof record.name === "string" && record.name) ||
      (typeof record.model === "string" && record.model) ||
      (typeof record.value === "string" && record.value);
    if (id) ids.push(id);
  }
  return ids;
};

const extractModelIds = (payload: unknown): string[] => {
  if (Array.isArray(payload)) {
    return extractModelIdsFromArray(payload);
  }
  const record = payload as Record<string, unknown>;
  if (!record) return [];
  const nested = record.result;
  if (nested) {
    const nestedIds = extractModelIds(nested);
    if (nestedIds.length > 0) return nestedIds;
  }
  const candidates = [record.models, record.data, record.items].filter(
    Array.isArray,
  ) as unknown[][];
  for (const candidate of candidates) {
    const ids = extractModelIdsFromArray(candidate);
    if (ids.length > 0) return ids;
  }
  return [];
};

const NEW_THREAD_PREVIEW = "New thread";

export const useHttpEffects = (
  store: ConversationStore,
): Omit<
  ConversationCommands,
  "connectWs" | "disconnectWs" | "approveRequest"
> => {
  const loadAvailableModels = useCallback(
    async (repoId: string) => {
      try {
        const result = await api.listModels(repoId);
        const models = extractModelIds(result);
        store.dispatch({
          type: "model/available_loaded",
          repoId,
          models,
        });
      } catch (error) {
        console.warn("Failed to load models", repoId, error);
        toast.error(
          error instanceof Error ? error.message : "Failed to load models",
        );
      }
    },
    [store],
  );

  const resumeThread = useCallback(
    async (repoId: string, threadId: string) => {
      const resumeResult = await api.resumeThread(repoId, threadId);
      const messages = buildMessagesFromResume(threadId, resumeResult);
      const reviewing = deriveReviewingFromResume(resumeResult);
      store.dispatch({ type: "messages/replace", threadId, messages });
      store.dispatch({
        type: "thread/status",
        threadId,
        patch: { reviewing, processing: false },
      });
    },
    [store],
  );

  const focusRepo = useCallback(
    async (repoId: string | null) => {
      if (!repoId) {
        store.dispatch({ type: "repo/focused", repoId: null });
        store.dispatch({ type: "thread/focused", threadId: null });
        return;
      }
      store.dispatch({ type: "repo/focused", repoId });
      try {
        await api.startSession(repoId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to start session",
        );
      }
      let threads = [] as Awaited<ReturnType<typeof api.listThreads>>;
      try {
        threads = await api.listThreads(repoId);
        store.dispatch({ type: "threads/loaded", repoId, threads });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load threads",
        );
      }
      const repo = store
        .getState()
        .repos.find((item) => item.repoId === repoId);
      const preferredThreadId =
        repo?.lastOpenedThreadId ?? threads[0]?.threadId ?? null;
      if (preferredThreadId) {
        store.dispatch({ type: "thread/focused", threadId: preferredThreadId });
        try {
          await resumeThread(repoId, preferredThreadId);
          await api.updateRepo(repoId, {
            lastOpenedThreadId: preferredThreadId,
          });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Failed to resume thread",
          );
        }
      } else {
        store.dispatch({ type: "thread/focused", threadId: null });
      }
      await loadAvailableModels(repoId);
    },
    [loadAvailableModels, resumeThread, store],
  );

  const focusThread = useCallback(
    async (repoId: string, threadId: string) => {
      if (store.getState().focusedRepoId !== repoId) {
        await focusRepo(repoId);
      }
      store.dispatch({ type: "thread/focused", threadId });
      try {
        await resumeThread(repoId, threadId);
        await api.updateRepo(repoId, { lastOpenedThreadId: threadId });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to resume thread",
        );
      }
    },
    [focusRepo, resumeThread, store],
  );

  const loadInitialData = useCallback(async () => {
    try {
      const repos = await api.listRepos();
      store.dispatch({ type: "repos/loaded", repos });
      const firstRepoId = repos[0]?.repoId ?? null;
      if (firstRepoId) {
        await focusRepo(firstRepoId);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load repos",
      );
    }

    try {
      const settings = await api.getModelSettings();
      store.dispatch({
        type: "model/settings_loaded",
        storedModel: settings.storedModel ?? null,
        defaultModel: settings.defaultModel ?? null,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load model",
      );
    }

    try {
      const permissionSettings = await api.getPermissionModeSettings();
      const mode = normalizePermissionMode(permissionSettings.defaultMode);
      store.dispatch({ type: "permission/loaded", mode });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load permission mode",
      );
    }
  }, [focusRepo, store]);

  const createThread = useCallback(
    async (repoId: string) => {
      const availableModels = store.getState().availableModelsByRepo[repoId];
      if (!availableModels || availableModels.length === 0) {
        await loadAvailableModels(repoId);
      }
      const updatedModels =
        store.getState().availableModelsByRepo[repoId] ?? [];
      if (updatedModels.length === 0) {
        toast.error("Model is not set");
        return;
      }
      const model = selectFocusedModel({
        ...store.getState(),
        focusedRepoId: repoId,
      });
      if (!model) {
        toast.error("Model is not set");
        return;
      }
      try {
        const threadId = await api.createThread(repoId, model);
        const repo = store
          .getState()
          .repos.find((item) => item.repoId === repoId);
        const now = new Date().toISOString();
        store.dispatch({
          type: "threads/optimistic_add",
          repoId,
          thread: {
            threadId,
            cwd: repo?.path,
            preview: NEW_THREAD_PREVIEW,
            createdAt: now,
            updatedAt: now,
          },
        });
        await focusThread(repoId, threadId);
        const threads = await api.listThreads(repoId);
        store.dispatch({ type: "threads/loaded", repoId, threads });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create thread",
        );
      }
    },
    [focusThread, loadAvailableModels, store],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const state = store.getState();
      const repoId = state.focusedRepoId;
      const threadId = selectFocusedThreadId(state);
      if (!repoId || !threadId) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const availableModels = selectAvailableModels(state);
      if (!availableModels || availableModels.length === 0) {
        toast.error("Model is not set");
        return;
      }
      const model = selectFocusedModel(state);
      if (!model) {
        toast.error("Model is not set");
        return;
      }
      const pendingId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      store.dispatch({
        type: "message/append",
        threadId,
        message: {
          id: pendingId,
          role: "user",
          text: trimmed,
          createdAt: Date.now(),
          pending: true,
        },
      });
      const nowIso = new Date().toISOString();
      const thread = state.threadsByRepo[repoId]?.find(
        (t) => t.threadId === threadId,
      );
      const previousPreview = thread?.preview ?? null;
      const previousLastMessageAt = thread?.lastMessageAt ?? null;
      store.dispatch({
        type: "thread/lastMessageAt_updated",
        repoId,
        threadId,
        lastMessageAt: nowIso,
      });
      if (!previousPreview || previousPreview.trim() === NEW_THREAD_PREVIEW) {
        store.dispatch({
          type: "thread/preview_updated",
          repoId,
          threadId,
          preview: trimmed,
        });
      }
      try {
        const permissionOptions = buildPermissionOptions(
          state.permissionMode,
          selectFocusedRepo(state)?.path,
        );
        const turn = await api.startTurn(
          repoId,
          threadId,
          [{ type: "text", text: trimmed }],
          { model, ...permissionOptions },
        );
        store.dispatch({ type: "turn/started", threadId, turnId: turn.turnId });
      } catch (error) {
        store.dispatch({
          type: "message/remove_pending",
          threadId,
          messageId: pendingId,
        });
        if (previousLastMessageAt) {
          store.dispatch({
            type: "thread/lastMessageAt_updated",
            repoId,
            threadId,
            lastMessageAt: previousLastMessageAt,
          });
        }
        if (previousPreview) {
          store.dispatch({
            type: "thread/preview_updated",
            repoId,
            threadId,
            preview: previousPreview,
          });
        }
        toast.error(error instanceof Error ? error.message : "Turn failed");
      }
    },
    [store],
  );

  const startReview = useCallback(
    async (target: ReviewTarget) => {
      const state = store.getState();
      const repoId = state.focusedRepoId;
      const threadId = selectFocusedThreadId(state);
      if (!repoId || !threadId) return;
      try {
        const result = await api.startReview(
          repoId,
          threadId,
          target,
          "inline",
        );
        store.dispatch({
          type: "turn/started",
          threadId,
          turnId: result.turnId,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Review failed");
      }
    },
    [store],
  );

  const stopActiveTurn = useCallback(async () => {
    const state = store.getState();
    const repoId = state.focusedRepoId;
    const threadId = selectFocusedThreadId(state);
    if (!repoId || !threadId) return;
    const turnId = state.activeTurnByThread[threadId];
    if (!turnId) return;
    try {
      await api.cancelTurn(repoId, turnId, threadId);
      store.dispatch({
        type: "turn/finished",
        threadId,
        status: "interrupted",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancel failed");
    }
  }, [store]);

  const updateModel = useCallback(
    async (model: string | null) => {
      const state = store.getState();
      const previous = state.modelSettings.storedModel;
      store.dispatch({
        type: "model/settings_loaded",
        storedModel: model,
        defaultModel: state.modelSettings.defaultModel,
      });
      try {
        const stored = await api.updateModelSetting(model);
        store.dispatch({
          type: "model/settings_loaded",
          storedModel: stored ?? null,
          defaultModel: state.modelSettings.defaultModel,
        });
      } catch (error) {
        store.dispatch({
          type: "model/settings_loaded",
          storedModel: previous ?? null,
          defaultModel: state.modelSettings.defaultModel,
        });
        toast.error(
          error instanceof Error ? error.message : "Failed to update model",
        );
      }
    },
    [store],
  );

  const updatePermissionMode = useCallback(
    (mode: import("../../../types").PermissionMode) => {
      store.dispatch({ type: "permission/changed", mode });
    },
    [store],
  );

  const addRepo = useCallback(async () => {
    try {
      const path = await api.pickRepoPath();
      if (!path) return;
      const name = extractRepoName(path);
      if (!name) {
        toast.error("Failed to derive repository name");
        return;
      }
      await api.createRepo(name, path);
      const repos = await api.listRepos();
      store.dispatch({ type: "repos/loaded", repos });
      const newRepoId = repos.find((repo) => repo.path === path)?.repoId;
      if (newRepoId) {
        await focusRepo(newRepoId);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add repo",
      );
    }
  }, [focusRepo, store]);

  return {
    loadInitialData,
    focusRepo,
    focusThread,
    createThread,
    sendMessage,
    startReview,
    stopActiveTurn,
    updateModel,
    updatePermissionMode,
    addRepo,
  };
};
