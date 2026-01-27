export type Repo = {
  repoId: string;
  name: string;
  path: string;
  lastOpenedThreadId?: string;
};

export type PermissionMode = "FullAccess" | "ReadOnly" | "OnRequest";

export type ReviewTargetType =
  | "uncommittedChanges"
  | "baseBranch"
  | "commit"
  | "custom";

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string };

export type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly" }
  | { type: "workspaceWrite"; writableRoots: string[]; networkAccess: boolean };

export type TurnStartOptions = {
  model?: string;
  approvalPolicy?: string;
  sandboxPolicy?: SandboxPolicy;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ThreadSummary = {
  threadId: string;
  cwd?: string;
  preview?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ThreadStatusFlags = {
  processing: boolean;
  reviewing: boolean;
  unread: boolean;
};

export type ThreadUiStatus =
  | "approval"
  | "reviewing"
  | "processing"
  | "unread"
  | "ready";

export type SessionStatus = "connected" | "starting" | "stopped" | "error";

export type WsInboundMessage =
  | {
      type: "subscribe_ack" | "unsubscribe_ack";
      requestId: string;
      payload: { repoId: string };
    }
  | {
      type: "subscribe_error";
      requestId: string;
      payload: { repoId: string; error: { code: string; message: string } };
    }
  | {
      type: "session_status";
      payload: { repoId: string; status: SessionStatus };
    }
  | {
      type: "thread_list_updated";
      payload: { repoId: string; threads: ThreadSummary[] };
    }
  | {
      type: "app_server_notification";
      payload: {
        repoId: string;
        message: { method: string; params?: JsonValue };
      };
    }
  | {
      type: "app_server_request";
      payload: {
        repoId: string;
        message: { id: number | string; method: string; params?: JsonValue };
      };
    };

export type WsOutboundMessage =
  | {
      type: "subscribe" | "unsubscribe";
      requestId: string;
      payload: { repoId: string };
    }
  | {
      type: "app_server_response";
      payload: {
        repoId: string;
        message: { id: number | string; result?: JsonValue; error?: JsonValue };
      };
    };

export type ChatMessage = {
  id: string;
  role: "agent" | "system" | "user" | "reasoning";
  text: string;
  createdAt: number;
  itemId?: string;
  pending?: boolean;
  summary?: string;
  content?: string;
  approval?: ApprovalMessage;
};

export type ApprovalMessage = {
  kind: "command" | "fileChange";
  outcome: "approved" | "rejected" | "approved_failed";
  commandText?: string | null;
  cwd?: string | null;
  fileChanges?: FileChange[] | null;
};

export type DiffEntry = {
  turnId: string;
  diffText: string;
  updatedAt: number;
};

export type FileChange = {
  path: string;
  kind?: string;
  diff?: string;
};

export type FileChangeEntry = {
  itemId: string;
  turnId?: string;
  status?: string;
  changes: FileChange[];
  updatedAt: number;
};

export type ApprovalRequest = {
  rpcId: number | string;
  method: string;
  params?: JsonValue;
  receivedAt: number;
  threadId?: string;
  turnId?: string;
  itemId?: string;
};
