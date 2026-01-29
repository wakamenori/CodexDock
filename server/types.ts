export type SessionStatus = "connected" | "starting" | "stopped" | "error";

export type RepoEntry = {
  repoId: string;
  name: string;
  path: string;
  lastOpenedThreadId?: string;
};

export type PermissionMode = "FullAccess" | "ReadOnly" | "OnRequest";

export type AppSettings = {
  model?: string | null;
  permissionMode?: PermissionMode | null;
  reasoningEffort?: string | null;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type RpcNotification = {
  method: string;
  params?: JsonValue;
};

export type RpcRequest = {
  id: number | string;
  method: string;
  params?: JsonValue;
};

export type RpcResponse = {
  id: number | string;
  result?: JsonValue;
  error?: JsonValue;
};
