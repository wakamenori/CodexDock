export type Repo = {
  repoId: string;
  name: string;
  path: string;
  lastOpenedThreadId?: string;
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
  updatedAt?: string;
};

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
  role: "agent" | "system" | "user";
  text: string;
  createdAt: number;
  itemId?: string;
  pending?: boolean;
};

export type DiffEntry = {
  turnId: string;
  diffText: string;
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
