import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { extractDiffFileNames } from "../diff";
import { useAutoScroll } from "../hooks/useAutoScroll";
import type { ChatMessage, DiffEntry } from "../types";
import { DiffViewer } from "./DiffViewer";

type ChatHistoryProps = {
  errorMessage: string | null;
  messages: ChatMessage[];
  diffs: DiffEntry[];
  selectedThreadId: string | null;
};

export function ChatHistory({
  errorMessage,
  messages,
  diffs,
  selectedThreadId,
}: ChatHistoryProps) {
  const historyRef = useAutoScroll([
    selectedThreadId,
    messages.length,
    diffs.length,
  ]);

  return (
    <div
      ref={historyRef}
      className="flex-1 overflow-y-auto px-6 py-5 space-y-4 scrollbar-thin"
    >
      {errorMessage && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      {messages.map((message) => {
        const isUser = message.role === "user";
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
              {message.pending && (
                <p className={`text-xs text-ink-300 ${isUser ? "text-right" : ""}`}>
                  pending
                </p>
              )}
              <div className="mt-2 text-sm leading-relaxed text-white markdown">
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
