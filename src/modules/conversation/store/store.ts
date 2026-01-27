import type { ConversationAction } from "./actions";
import { reduceConversation } from "./reducer";
import type { ConversationState } from "./state";
import { initialConversationState } from "./state";

type Listener = () => void;

export type ConversationStore = {
  getState: () => ConversationState;
  dispatch: (action: ConversationAction) => void;
  subscribe: (listener: Listener) => () => void;
};

export const createConversationStore = (
  initialState: ConversationState = initialConversationState,
): ConversationStore => {
  let state = initialState;
  const listeners = new Set<Listener>();

  const getState = () => state;

  const dispatch = (action: ConversationAction) => {
    state = reduceConversation(state, action);
    listeners.forEach((listener) => {
      listener();
    });
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { getState, dispatch, subscribe };
};
