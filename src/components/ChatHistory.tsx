import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { extractDiffFileNames } from "../diff";
import { useAutoScroll } from "../hooks/useAutoScroll";
import type { ChatMessage, DiffEntry } from "../types";
import { copyToClipboard } from "../utils/clipboard";
import { DiffViewer } from "./DiffViewer";
import { ReasoningItem } from "./ReasoningItem";

type ChatHistoryProps = {
  messages: ChatMessage[];
  diffs: DiffEntry[];
  selectedThreadId: string | null;
};

export function ChatHistory({
  messages,
  diffs,
  selectedThreadId,
}: ChatHistoryProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useAutoScroll([
    selectedThreadId,
    messages.length,
    diffs.length,
  ]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async (message: ChatMessage) => {
    const copied = await copyToClipboard(message.text);
    if (!copied) {
      return;
    }
    setCopiedMessageId(message.id);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopiedMessageId(null);
    }, 2000);
  }, []);

  return (
    <div
      ref={historyRef}
      className="flex-1 overflow-y-auto px-6 py-5 space-y-4 scrollbar-thin"
    >
      {messages.map((message) => {
        if (message.role === "reasoning") {
          return <ReasoningItem key={message.id} message={message} />;
        }
        const isUser = message.role === "user";
        const isCopyable = message.role === "user" || message.role === "agent";
        const isCopied = copiedMessageId === message.id;
        return (
          <div
            key={message.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl border px-4 py-3 ${
                isUser
                  ? "border-neon-500/30 bg-ink-900/80"
                  : "border-ink-700 bg-ink-800/70"
              } ${message.pending ? "opacity-70" : ""}`}
            >
              {isCopyable && (
                <div
                  className={`mb-2 flex items-center ${
                    message.pending ? "justify-between" : "justify-end"
                  }`}
                >
                  {message.pending && (
                    <p
                      className={`text-xs text-ink-300 ${isUser ? "text-right" : ""}`}
                    >
                      pending
                    </p>
                  )}
                  <button
                    type="button"
                    className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-[0.2em] transition ${
                      isCopied
                        ? "border-neon-400/70 text-neon-300"
                        : "border-ink-600 text-ink-300 hover:border-ink-400 hover:text-ink-100"
                    }`}
                    onClick={() => {
                      void handleCopy(message);
                    }}
                    aria-label="Copy message"
                    title="Copy message"
                  >
                    {isCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
              <div className="mt-2 text-sm leading-relaxed text-ink-200 markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.text}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      })}

      {diffs.map((diff) => (
        <div
          key={diff.turnId}
          className="rounded-xl border border-neon-500/30 bg-ink-900/80 px-4 py-3"
        >
          <p className="text-xs text-neon-300">
            {extractDiffFileNames(diff.diffText).join(", ") || diff.turnId}
          </p>
          <DiffViewer diffText={diff.diffText} />
        </div>
      ))}

      {!messages.length && !diffs.length && (
        <div className="rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-300">
          Start a turn to see the stream here.
        </div>
      )}
    </div>
  );
}
