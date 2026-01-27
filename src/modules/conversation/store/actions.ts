import type {
  ApprovalRequest,
  ChatMessage,
  FileChangeEntry,
  PermissionMode,
  Repo,
  SessionStatus,
  ThreadStatusFlags,
  ThreadSummary,
} from "../../../types";

export type ConversationAction =
  // Repo/Thread list
  | { type: "repos/loaded"; repos: Repo[] }
  | { type: "repo/focused"; repoId: string | null }
  | { type: "threads/loaded"; repoId: string; threads: ThreadSummary[] }
  | { type: "threads/optimistic_add"; repoId: string; thread: ThreadSummary }
  | { type: "threads/optimistic_remove"; repoId: string; threadId: string }
  | { type: "thread/focused"; threadId: string | null }
  | {
      type: "thread/preview_updated";
      repoId: string;
      threadId: string;
      preview: string;
    }
  | {
      type: "thread/lastMessageAt_updated";
      repoId: string;
      threadId: string;
      lastMessageAt: string;
    }
  | { type: "session/status"; repoId: string; status: SessionStatus }

  // Messages / reasoning / diffs / file changes
  | { type: "messages/replace"; threadId: string; messages: ChatMessage[] }
  | { type: "message/append"; threadId: string; message: ChatMessage }
  | { type: "message/remove_pending"; threadId: string; messageId: string }
  | {
      type: "message/delta";
      threadId: string;
      itemId: string;
      deltaText: string;
    }
  | {
      type: "message/started";
      threadId: string;
      itemId: string;
      role: "user" | "agent" | "assistant";
      text?: string;
    }
  | {
      type: "reasoning/started";
      threadId: string;
      itemId: string;
      summary: string;
      content: string;
      summaryParts?: string[];
      contentParts?: string[];
    }
  | {
      type: "reasoning/delta";
      threadId: string;
      itemId: string;
      deltaText: string;
      isSummary: boolean;
      summaryIndex?: number;
      contentIndex?: number;
    }
  | {
      type: "reasoning/summaryPartAdded";
      threadId: string;
      itemId: string;
      summaryIndex: number;
    }
  | { type: "diff/updated"; threadId: string; turnId: string; diffText: string }
  | {
      type: "fileChange/updated";
      threadId: string;
      itemId: string;
      turnId?: string;
      status?: string;
      changes: FileChangeEntry["changes"];
    }

  // Approvals
  | { type: "approval/received"; threadId: string; request: ApprovalRequest }
  | { type: "approval/resolved"; threadId: string; rpcId: number | string }

  // Turn / thread status
  | { type: "turn/started"; threadId: string; turnId: string }
  | {
      type: "turn/finished";
      threadId: string;
      status: "completed" | "failed" | "error" | "interrupted";
    }
  | {
      type: "thread/status";
      threadId: string;
      patch: Partial<ThreadStatusFlags>;
    }

  // Settings
  | {
      type: "model/settings_loaded";
      storedModel: string | null;
      defaultModel: string | null;
    }
  | { type: "model/available_loaded"; repoId: string; models: string[] }
  | { type: "permission/loaded"; mode: PermissionMode }
  | { type: "permission/changed"; mode: PermissionMode }

  // Connection
  | { type: "connection/status"; wsConnected: boolean };
