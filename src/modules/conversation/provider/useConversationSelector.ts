import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ConversationState } from "../store/state";
import { ConversationContext } from "./ConversationProvider";

const defaultCompare = <T>(a: T, b: T) => Object.is(a, b);

export const useConversationSelector = <T>(
  selector: (state: ConversationState) => T,
  isEqual: (a: T, b: T) => boolean = defaultCompare,
): T => {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error(
      "useConversationSelector must be used within ConversationProvider",
    );
  }
  const { store } = context;
  const lastSelectedRef = useRef<T>();
  const lastStateRef = useRef<ConversationState | null>(null);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    if (
      lastStateRef.current === state &&
      lastSelectedRef.current !== undefined
    ) {
      return lastSelectedRef.current;
    }
    const next = selector(state);
    lastStateRef.current = state;
    lastSelectedRef.current = next;
    return next;
  }, [selector, store]);

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );

  const selected = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const isSame =
    lastSelectedRef.current !== undefined &&
    isEqual(lastSelectedRef.current, selected);

  useEffect(() => {
    if (!isSame) {
      lastSelectedRef.current = selected;
    }
  }, [isSame, selected]);

  return isSame && lastSelectedRef.current !== undefined
    ? lastSelectedRef.current
    : selected;
};
