import type { ReactNode } from "react";
import { createContext, useEffect, useMemo, useRef } from "react";
import type { ConversationStore } from "../store/store";
import { createConversationStore } from "../store/store";
import type { ConversationCommands } from "./useConversationCommands";
import { useConversationCommandsInternal } from "./useConversationCommands";

export const ConversationContext = createContext<
  | {
      store: ConversationStore;
      commands: ConversationCommands;
    }
  | undefined
>(undefined);

export const ConversationProvider = ({ children }: { children: ReactNode }) => {
  const storeRef = useRef<ConversationStore>();
  if (!storeRef.current) {
    storeRef.current = createConversationStore();
  }

  const commands = useConversationCommandsInternal(storeRef.current);

  useEffect(() => {
    commands.loadInitialData();
    commands.connectWs();
    return () => {
      commands.disconnectWs();
    };
  }, [commands]);

  const value = useMemo(
    () => ({ store: storeRef.current as ConversationStore, commands }),
    [commands],
  );

  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  );
};
