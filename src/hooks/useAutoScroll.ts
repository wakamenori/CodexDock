import type { DependencyList } from "react";
import { useEffect, useRef } from "react";

export const useAutoScroll = (deps: DependencyList) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [...deps]);

  return ref;
};
