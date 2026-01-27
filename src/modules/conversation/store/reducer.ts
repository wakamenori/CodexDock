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
import type { ConversationAction } from "./actions";
import type { ConversationState } from "./state";
import { initialConversationState } from "./state";

const defaultThreadStatus =
  (): ConversationState["threadStatusByThread"][string] => ({
    processing: false,
    reviewing: false,
    unread: false,
  });

const ensureThreadStatus = (
  map: ConversationState["threadStatusByThread"],
  threadId: string,
) => map[threadId] ?? defaultThreadStatus();

const upsertThreadStatus = (
  map: ConversationState["threadStatusByThread"],
  threadId: string,
  patch: Partial<ConversationState["threadStatusByThread"][string]>,
) => ({
  ...map,
  [threadId]: { ...ensureThreadStatus(map, threadId), ...patch },
});

export const reduceConversation = (
  state: ConversationState = initialConversationState,
  action: ConversationAction,
): ConversationState => {
  switch (action.type) {
    case "repos/loaded": {
      const nextFocused =
        state.focusedRepoId ?? action.repos[0]?.repoId ?? null;
      return {
        ...state,
        repos: action.repos,
        focusedRepoId: nextFocused,
      };
    }
    case "repo/focused": {
      return {
        ...state,
        focusedRepoId: action.repoId,
      };
    }
    case "threads/loaded": {
      const existing = state.threadsByRepo[action.repoId] ?? [];
      const focusedThreadId = state.focusedThreadId;
      const incomingHasFocused =
        focusedThreadId &&
        action.threads.some((item) => item.threadId === focusedThreadId);
      const shouldPreserveFocused =
        focusedThreadId && !incomingHasFocused
          ? (existing.find((item) => item.threadId === focusedThreadId) ?? null)
          : null;
      const nextThreads = shouldPreserveFocused
        ? [...action.threads, shouldPreserveFocused]
        : action.threads;
      return {
        ...state,
        threadsByRepo: {
          ...state.threadsByRepo,
          [action.repoId]: nextThreads,
        },
      };
    }
    case "threads/optimistic_add": {
      const list = state.threadsByRepo[action.repoId] ?? [];
      if (list.some((item) => item.threadId === action.thread.threadId)) {
        return state;
      }
      return {
        ...state,
        threadsByRepo: {
          ...state.threadsByRepo,
          [action.repoId]: [...list, action.thread],
        },
      };
    }
    case "threads/optimistic_remove": {
      const list = state.threadsByRepo[action.repoId] ?? [];
      return {
        ...state,
        threadsByRepo: {
          ...state.threadsByRepo,
          [action.repoId]: list.filter(
            (item) => item.threadId !== action.threadId,
          ),
        },
      };
    }
    case "thread/focused": {
      if (!action.threadId) {
        return { ...state, focusedThreadId: null };
      }
      const nextStatus = upsertThreadStatus(
        state.threadStatusByThread,
        action.threadId,
        { unread: false },
      );
      return {
        ...state,
        focusedThreadId: action.threadId,
        threadStatusByThread: nextStatus,
      };
    }
    case "thread/preview_updated": {
      const threads = state.threadsByRepo[action.repoId] ?? [];
      const nextThreads = threads.map((thread) =>
        thread.threadId === action.threadId && action.preview
          ? { ...thread, preview: action.preview }
          : thread,
      );
      return {
        ...state,
        threadsByRepo: { ...state.threadsByRepo, [action.repoId]: nextThreads },
      };
    }
    case "thread/lastMessageAt_updated": {
      const threads = state.threadsByRepo[action.repoId] ?? [];
      const nextThreads = threads.map((thread) =>
        thread.threadId === action.threadId && action.lastMessageAt
          ? { ...thread, lastMessageAt: action.lastMessageAt }
          : thread,
      );
      return {
        ...state,
        threadsByRepo: { ...state.threadsByRepo, [action.repoId]: nextThreads },
      };
    }
    case "session/status": {
      return {
        ...state,
        sessionStatusByRepo: {
          ...state.sessionStatusByRepo,
          [action.repoId]: action.status,
        },
      };
    }

    case "messages/replace": {
      return {
        ...state,
        messagesByThread: {
          ...state.messagesByThread,
          [action.threadId]: action.messages,
        },
      };
    }
    case "message/append": {
      const list = state.messagesByThread[action.threadId] ?? [];
      return {
        ...state,
        messagesByThread: {
          ...state.messagesByThread,
          [action.threadId]: [...list, action.message],
        },
      };
    }
    case "message/remove_pending": {
      const list = state.messagesByThread[action.threadId] ?? [];
      return {
        ...state,
        messagesByThread: {
          ...state.messagesByThread,
          [action.threadId]: list.filter(
            (msg) =>
              msg.id !== action.messageId && msg.itemId !== action.messageId,
          ),
        },
      };
    }
    case "message/delta": {
      const list = state.messagesByThread[action.threadId] ?? [];
      return {
        ...state,
        messagesByThread: {
          ...state.messagesByThread,
          [action.threadId]: upsertAgentDelta(
            list,
            action.itemId,
            action.deltaText,
          ),
        },
      };
    }
    case "message/started": {
      const list = state.messagesByThread[action.threadId] ?? [];
      const nextMessages =
        action.role === "user"
          ? applyUserMessageStart(list, action.itemId, action.text)
          : applyAgentMessageStart(list, action.itemId, action.text ?? "");
      return {
        ...state,
        messagesByThread: {
          ...state.messagesByThread,
          [action.threadId]: nextMessages,
        },
      };
    }
    case "reasoning/started": {
      const list = state.messagesByThread[action.threadId] ?? [];
      return {
        ...state,
        messagesByThread: {
          ...state.messagesByThread,
          [action.threadId]: applyReasoningStart(
            list,
            action.itemId,
            action.summary,
            action.content,
          ),
        },
      };
    }
    case "reasoning/delta": {
      const list = state.messagesByThread[action.threadId] ?? [];
      return {
        ...state,
        messagesByThread: {
          ...state.messagesByThread,
          [action.threadId]: upsertReasoningDelta(
            list,
            action.itemId,
            action.deltaText,
            action.isSummary,
          ),
        },
      };
    }

    case "diff/updated": {
      const list = state.diffsByThread[action.threadId] ?? [];
      return {
        ...state,
        diffsByThread: {
          ...state.diffsByThread,
          [action.threadId]: applyDiffUpdate(
            list,
            action.turnId,
            action.diffText,
          ),
        },
      };
    }

    case "fileChange/updated": {
      const map = state.fileChangesByThread[action.threadId] ?? {};
      return {
        ...state,
        fileChangesByThread: {
          ...state.fileChangesByThread,
          [action.threadId]: applyFileChangeUpdate(map, {
            itemId: action.itemId,
            turnId: action.turnId,
            status: action.status,
            changes: action.changes,
          }),
        },
      };
    }

    case "approval/received": {
      const list = state.approvalsByThread[action.threadId] ?? [];
      if (list.some((item) => item.rpcId === action.request.rpcId)) {
        return state;
      }
      const nextStatus = upsertThreadStatus(
        state.threadStatusByThread,
        action.threadId,
        state.focusedThreadId === action.threadId ? {} : { unread: true },
      );
      return {
        ...state,
        approvalsByThread: {
          ...state.approvalsByThread,
          [action.threadId]: [...list, action.request],
        },
        threadStatusByThread: nextStatus,
      };
    }
    case "approval/resolved": {
      const list = state.approvalsByThread[action.threadId] ?? [];
      return {
        ...state,
        approvalsByThread: {
          ...state.approvalsByThread,
          [action.threadId]: removeApproval(list, action.rpcId),
        },
      };
    }

    case "turn/started": {
      return {
        ...state,
        activeTurnByThread: {
          ...state.activeTurnByThread,
          [action.threadId]: action.turnId,
        },
        threadStatusByThread: upsertThreadStatus(
          state.threadStatusByThread,
          action.threadId,
          { processing: true },
        ),
      };
    }
    case "turn/finished": {
      return {
        ...state,
        activeTurnByThread: {
          ...state.activeTurnByThread,
          [action.threadId]: null,
        },
        threadStatusByThread: upsertThreadStatus(
          state.threadStatusByThread,
          action.threadId,
          { processing: false },
        ),
      };
    }
    case "thread/status": {
      return {
        ...state,
        threadStatusByThread: upsertThreadStatus(
          state.threadStatusByThread,
          action.threadId,
          action.patch,
        ),
      };
    }

    case "model/settings_loaded": {
      return {
        ...state,
        modelSettings: {
          storedModel: action.storedModel,
          defaultModel: action.defaultModel,
          loaded: true,
        },
      };
    }
    case "model/available_loaded": {
      return {
        ...state,
        availableModelsByRepo: {
          ...state.availableModelsByRepo,
          [action.repoId]: action.models,
        },
      };
    }

    case "permission/loaded": {
      return { ...state, permissionMode: action.mode };
    }
    case "permission/changed": {
      return { ...state, permissionMode: action.mode };
    }

    case "connection/status": {
      return { ...state, connection: { wsConnected: action.wsConnected } };
    }

    default:
      return state;
  }
};
