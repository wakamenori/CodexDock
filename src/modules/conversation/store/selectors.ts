import type { ThreadUiStatus } from "../../../types";
import { normalizeRootPath } from "../domain/parsers";
import type { ConversationState } from "./state";

export const selectFocusedRepoId = (state: ConversationState) =>
  state.focusedRepoId;

export const selectFocusedRepo = (state: ConversationState) =>
  state.repos.find((repo) => repo.repoId === state.focusedRepoId) ?? null;

export const selectFocusedThreadId = (state: ConversationState) =>
  state.focusedThreadId;

export const selectFocusedThread = (state: ConversationState) => {
  if (!state.focusedRepoId || !state.focusedThreadId) return null;
  const threads = state.threadsByRepo[state.focusedRepoId] ?? [];
  return (
    threads.find((thread) => thread.threadId === state.focusedThreadId) ?? null
  );
};

export const selectSessionStatusByRepo = (state: ConversationState) =>
  state.sessionStatusByRepo;

export const selectRepoGroups = (state: ConversationState) => {
  return state.repos.map((repo) => {
    const list = state.threadsByRepo[repo.repoId] ?? [];
    const normalizedRepoPath = normalizeRootPath(repo.path);
    const threads = normalizedRepoPath
      ? list.filter(
          (thread) => normalizeRootPath(thread.cwd) === normalizedRepoPath,
        )
      : list;
    return {
      repo,
      threads,
      sessionStatus: state.sessionStatusByRepo[repo.repoId] ?? "stopped",
    };
  });
};

export const selectFocusedThreadMessages = (state: ConversationState) =>
  state.focusedThreadId
    ? (state.messagesByThread[state.focusedThreadId] ?? [])
    : [];

export const selectFocusedThreadDiffs = (state: ConversationState) =>
  state.focusedThreadId
    ? (state.diffsByThread[state.focusedThreadId] ?? [])
    : [];

export const selectFocusedThreadFileChanges = (state: ConversationState) =>
  state.focusedThreadId
    ? (state.fileChangesByThread[state.focusedThreadId] ?? {})
    : {};

export const selectFocusedThreadApprovals = (state: ConversationState) =>
  state.focusedThreadId
    ? (state.approvalsByThread[state.focusedThreadId] ?? [])
    : [];

export const selectFocusedThreadActiveTurnId = (state: ConversationState) =>
  state.focusedThreadId
    ? (state.activeTurnByThread[state.focusedThreadId] ?? null)
    : null;

export const selectThreadUiStatusById = (
  state: ConversationState,
): Record<string, ThreadUiStatus> => {
  const threadIds = new Set<string>([
    ...Object.keys(state.threadStatusByThread),
    ...Object.keys(state.approvalsByThread),
  ]);
  const result: Record<string, ThreadUiStatus> = {};
  for (const threadId of threadIds) {
    const status = state.threadStatusByThread[threadId] ?? {
      processing: false,
      reviewing: false,
      unread: false,
    };
    const approvals = state.approvalsByThread[threadId] ?? [];
    if (approvals.length > 0) {
      result[threadId] = "approval";
      continue;
    }
    if (status.reviewing) {
      result[threadId] = "reviewing";
      continue;
    }
    if (status.processing) {
      result[threadId] = "processing";
      continue;
    }
    if (status.unread) {
      result[threadId] = "unread";
      continue;
    }
    result[threadId] = "ready";
  }
  return result;
};

export const selectAvailableModels = (state: ConversationState) =>
  state.focusedRepoId
    ? state.availableModelsByRepo[state.focusedRepoId]
    : undefined;

export const selectFocusedModel = (state: ConversationState) => {
  const availableModels = selectAvailableModels(state);
  const { storedModel, defaultModel, loaded } = state.modelSettings;
  if (!loaded) return storedModel;
  if (!availableModels) return storedModel;
  if (availableModels.length === 0) return null;
  if (storedModel && availableModels.includes(storedModel)) return storedModel;
  if (defaultModel && availableModels.includes(defaultModel))
    return defaultModel;
  return availableModels[0] ?? null;
};

export const selectPermissionMode = (state: ConversationState) =>
  state.permissionMode;

export const selectWsConnected = (state: ConversationState) =>
  state.connection.wsConnected;

export const selectFocusedThreadRunning = (state: ConversationState) =>
  state.focusedThreadId
    ? Boolean(state.threadStatusByThread[state.focusedThreadId]?.processing)
    : false;
