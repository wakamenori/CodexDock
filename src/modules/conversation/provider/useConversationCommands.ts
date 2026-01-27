import { useContext } from "react";
import { ConversationContext } from "./ConversationProvider";

export type ConversationCommands = {
  loadInitialData: () => Promise<void> | void;
  connectWs: () => void;
  disconnectWs: () => void;
  focusRepo: (repoId: string | null) => Promise<void>;
  focusThread: (repoId: string, threadId: string) => Promise<void>;
  createThread: (repoId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  startReview: (target: import("../../../types").ReviewTarget) => Promise<void>;
  stopActiveTurn: () => Promise<void>;
  updateModel: (model: string | null) => Promise<void>;
  updatePermissionMode: (mode: import("../../../types").PermissionMode) => void;
  approveRequest: (
    repoId: string,
    request: import("../../../types").ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
  addRepo: () => Promise<void>;
};

export const useConversationCommands = () => {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error(
      "useConversationCommands must be used within ConversationProvider",
    );
  }
  return context.commands;
};

// Internal hook used by ConversationProvider to wire effects and commands.
export { useConversationCommandsInternal } from "../effects/useConversationCommandsInternal";
