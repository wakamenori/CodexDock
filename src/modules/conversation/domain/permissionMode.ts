import type { PermissionMode, SandboxPolicy } from "../../../types";

type PermissionOptions = {
  approvalPolicy: string;
  sandboxPolicy: SandboxPolicy;
};

const READ_ONLY_OPTIONS: PermissionOptions = {
  approvalPolicy: "on-request",
  sandboxPolicy: { type: "readOnly" },
};

export const normalizePermissionMode = (value: unknown): PermissionMode => {
  if (value === "FullAccess" || value === "ReadOnly" || value === "OnRequest") {
    return value;
  }
  return "ReadOnly";
};

export const buildPermissionOptions = (
  mode: PermissionMode,
  repoPath: string | null | undefined,
): PermissionOptions => {
  if (mode === "FullAccess") {
    return {
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  if (mode === "OnRequest") {
    if (repoPath) {
      return {
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [repoPath],
          networkAccess: true,
        },
      };
    }
    return READ_ONLY_OPTIONS;
  }
  return READ_ONLY_OPTIONS;
};

export const PERMISSION_MODE_OPTIONS: PermissionMode[] = [
  "FullAccess",
  "ReadOnly",
  "OnRequest",
];
