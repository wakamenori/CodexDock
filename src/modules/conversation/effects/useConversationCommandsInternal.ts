import { useMemo } from "react";
import type { ConversationCommands } from "../provider/useConversationCommands";
import type { ConversationStore } from "../store/store";
import { useHttpEffects } from "./useHttpEffects";
import { useWsEffects } from "./useWsEffects";

export const useConversationCommandsInternal = (
  store: ConversationStore,
): ConversationCommands => {
  const ws = useWsEffects(store);
  const http = useHttpEffects(store);
  const { connect, disconnect, approveRequest } = ws;

  return useMemo(
    () => ({
      ...http,
      connectWs: connect,
      disconnectWs: disconnect,
      approveRequest,
    }),
    [approveRequest, connect, disconnect, http],
  );
};
