import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  FileChangeEntry,
  PermissionMode,
  Repo,
  SessionStatus,
  ThreadStatusFlags,
  ThreadSummary,
} from "../../../types";

export type ConversationState = {
  repos: Repo[];
  focusedRepoId: string | null;
  threadsByRepo: Record<string, ThreadSummary[]>;
  focusedThreadId: string | null;
  sessionStatusByRepo: Record<string, SessionStatus>;

  messagesByThread: Record<string, ChatMessage[]>;
  diffsByThread: Record<string, DiffEntry[]>;
  fileChangesByThread: Record<string, Record<string, FileChangeEntry>>;
  approvalsByThread: Record<string, ApprovalRequest[]>;
  activeTurnByThread: Record<string, string | null>;
  threadStatusByThread: Record<string, ThreadStatusFlags>;

  modelSettings: {
    storedModel: string | null;
    defaultModel: string | null;
    loaded: boolean;
  };
  availableModelsByRepo: Record<string, string[]>;

  permissionMode: PermissionMode;

  connection: {
    wsConnected: boolean;
  };
};

export const initialConversationState: ConversationState = {
  repos: [],
  focusedRepoId: null,
  threadsByRepo: {},
  focusedThreadId: null,
  sessionStatusByRepo: {},

  messagesByThread: {},
  diffsByThread: {},
  fileChangesByThread: {},
  approvalsByThread: {},
  activeTurnByThread: {},
  threadStatusByThread: {},

  modelSettings: { storedModel: null, defaultModel: null, loaded: false },
  availableModelsByRepo: {},

  permissionMode: "ReadOnly",

  connection: { wsConnected: false },
};
