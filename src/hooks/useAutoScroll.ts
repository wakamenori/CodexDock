import type { DependencyList } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type AutoScrollOptions = {
  deps: DependencyList;
  resetKey?: string | null;
  threshold?: number;
};

const DEFAULT_THRESHOLD = 24;

export const useAutoScroll = ({
  deps,
  resetKey,
  threshold = DEFAULT_THRESHOLD,
}: AutoScrollOptions) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const autoScrollRef = useRef(true);
  const userScrollIntentRef = useRef(false);

  const setAutoScrollEnabled = useCallback((value: boolean) => {
    autoScrollRef.current = value;
    setIsAutoScrollEnabled(value);
  }, []);

  const scrollToBottom = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  const isAtBottom = useCallback(() => {
    const node = containerRef.current;
    if (!node) return true;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    return distance <= threshold;
  }, [threshold]);

  useEffect(() => {
    if (resetKey === undefined) return;
    setAutoScrollEnabled(true);
    setHasNewMessages(false);
    scrollToBottom();
  }, [resetKey, scrollToBottom, setAutoScrollEnabled]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const markUserIntent = () => {
      userScrollIntentRef.current = true;
    };
    const handleScroll = () => {
      const atBottom = isAtBottom();
      if (atBottom) {
        setAutoScrollEnabled(true);
        setHasNewMessages(false);
        userScrollIntentRef.current = false;
        return;
      }
      if (!userScrollIntentRef.current) {
        return;
      }
      setAutoScrollEnabled(false);
    };
    node.addEventListener("wheel", markUserIntent, { passive: true });
    node.addEventListener("touchmove", markUserIntent, { passive: true });
    node.addEventListener("pointerdown", markUserIntent, { passive: true });
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      node.removeEventListener("wheel", markUserIntent);
      node.removeEventListener("touchmove", markUserIntent);
      node.removeEventListener("pointerdown", markUserIntent);
      node.removeEventListener("scroll", handleScroll);
    };
  }, [isAtBottom, setAutoScrollEnabled]);

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollToBottom();
      setHasNewMessages(false);
      return;
    }
    setHasNewMessages(true);
  }, [...deps, scrollToBottom]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const target = contentRef.current;
    if (!target) return;
    const observer = new ResizeObserver(() => {
      if (autoScrollRef.current) {
        scrollToBottom();
        setHasNewMessages(false);
      } else {
        setHasNewMessages(true);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  const enableAutoScroll = useCallback(() => {
    setAutoScrollEnabled(true);
    setHasNewMessages(false);
    userScrollIntentRef.current = false;
    scrollToBottom();
  }, [scrollToBottom, setAutoScrollEnabled]);

  return {
    containerRef,
    contentRef,
    isAutoScrollEnabled,
    hasNewMessages,
    enableAutoScroll,
  };
};
