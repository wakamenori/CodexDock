import { useCallback, useEffect, useRef, useState } from "react";
import { useAutoScroll } from "../hooks/useAutoScroll";
import {
  buildUploadImageUrl,
  extractFileName,
  toRelativePath,
} from "../shared/paths";
import type { ChatMessage, ToolTimelineItem } from "../types";
import { copyToClipboard } from "../utils/clipboard";
import { DiffViewer } from "./DiffViewer";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ReasoningItem } from "./ReasoningItem";
import { ToolCallCard } from "./ToolCallCard";

type ChatHistoryProps = {
  messages: ChatMessage[];
  toolItems: ToolTimelineItem[];
  selectedThreadId: string | null;
  selectedRepoPath: string | null;
};

export function ChatHistory({
  messages,
  toolItems,
  selectedThreadId,
  selectedRepoPath,
}: ChatHistoryProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessage = messages[messages.length - 1];
  const lastToolItem = toolItems[toolItems.length - 1];
  const {
    containerRef,
    contentRef,
    isAutoScrollEnabled,
    hasNewMessages,
    enableAutoScroll,
  } = useAutoScroll({
    deps: [
      selectedThreadId,
      messages.length,
      toolItems.length,
      lastMessage?.text.length ?? 0,
      lastToolItem?.itemId ?? "",
    ],
    resetKey: selectedThreadId,
  });

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
    <div className="relative flex flex-col flex-1 min-h-0">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-6 py-5 space-y-4 scrollbar-thin"
      >
        <div ref={contentRef} className="space-y-4">
          {[
            ...messages.map((message) => ({
              kind: "message" as const,
              createdAt: message.createdAt,
              key: `message-${message.id}`,
              message,
            })),
            ...toolItems.map((item) => ({
              kind: "tool" as const,
              createdAt: item.createdAt,
              key: `tool-${item.itemId}`,
              item,
            })),
          ]
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((entry) => {
              if (entry.kind === "tool") {
                return (
                  <ToolCallCard
                    key={entry.key}
                    item={entry.item}
                    selectedRepoPath={selectedRepoPath}
                  />
                );
              }
              const message = entry.message;
              if (message.approval) {
                const approval = message.approval;
                const isCopied = copiedMessageId === message.id;
                const outcomeTone =
                  approval.outcome === "approved"
                    ? {
                        border: "border-neon-500/40",
                        bg: "bg-ink-900/80",
                        label: "text-neon-300",
                      }
                    : approval.outcome === "rejected"
                      ? {
                          border: "border-red-400/40",
                          bg: "bg-ink-900/80",
                          label: "text-red-300",
                        }
                      : {
                          border: "border-amber-400/40",
                          bg: "bg-ink-900/80",
                          label: "text-amber-300",
                        };
                const header =
                  approval.outcome === "approved"
                    ? "Approved"
                    : approval.outcome === "rejected"
                      ? "Rejected"
                      : "Approved (failed)";
                return (
                  <div key={message.id} className="flex justify-start">
                    <div
                      className={`max-w-[85%] rounded-xl border px-4 py-3 ${outcomeTone.border} ${outcomeTone.bg}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs uppercase tracking-[0.2em] text-ink-400">
                          Approval
                        </p>
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
                      <p
                        className={`text-sm font-semibold ${outcomeTone.label}`}
                      >
                        {header}{" "}
                        {approval.kind === "command"
                          ? "command"
                          : "file change"}
                      </p>
                      {approval.kind === "command" && (
                        <div className="mt-3 grid gap-2">
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                            {approval.commandText ?? "command unavailable."}
                          </pre>
                          <p className="text-xs text-ink-400">
                            cwd:{" "}
                            {approval.cwd
                              ? toRelativePath(approval.cwd, selectedRepoPath)
                              : "(unknown)"}
                          </p>
                        </div>
                      )}
                      {approval.kind === "fileChange" && (
                        <div className="mt-3 grid gap-3">
                          {approval.fileChanges?.length ? (
                            approval.fileChanges.map((change, index) => (
                              <div
                                key={`${message.id}-${change.path}-${index}`}
                                className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2"
                              >
                                <p className="text-xs font-semibold text-ink-100">
                                  {toRelativePath(
                                    change.path || "",
                                    selectedRepoPath,
                                  ) || "(unknown file)"}
                                </p>
                                {change.diff ? (
                                  <DiffViewer diffText={change.diff} />
                                ) : (
                                  <p className="mt-2 text-xs text-ink-400">
                                    diff unavailable.
                                  </p>
                                )}
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-ink-400">
                              diff unavailable.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              if (message.role === "reasoning") {
                return <ReasoningItem key={message.id} message={message} />;
              }
              const isUser = message.role === "user";
              const isCopyable =
                message.role === "user" || message.role === "agent";
              const isCopied = copiedMessageId === message.id;
              const images = message.images ?? [];
              const imageNodes = images
                .map((image, index) => {
                  const src =
                    image.url ??
                    buildUploadImageUrl(image.path ?? null) ??
                    null;
                  if (!src) return null;
                  const fallbackName =
                    image.name ?? extractFileName(image.path ?? null);
                  const altText = fallbackName ?? "attached image";
                  return (
                    <div
                      key={`${message.id}-image-${index}`}
                      className="relative overflow-hidden rounded-lg border border-ink-800 bg-ink-950/60"
                    >
                      <img
                        src={src}
                        alt={altText}
                        className="h-28 w-40 object-cover"
                        loading="lazy"
                      />
                    </div>
                  );
                })
                .filter((node) => node !== null);
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
                    {imageNodes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {imageNodes}
                      </div>
                    )}
                    {message.text ? (
                      <div className="mt-2 text-sm leading-relaxed text-ink-200 markdown">
                        <MarkdownRenderer>{message.text}</MarkdownRenderer>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

          {!messages.length && toolItems.length === 0 && (
            <div className="rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-300">
              Start a turn to see the stream here.
            </div>
          )}
        </div>
      </div>
      {!isAutoScrollEnabled && (
        <button
          type="button"
          onClick={() => enableAutoScroll()}
          className={`absolute bottom-6 right-6 grid h-11 w-11 place-items-center rounded-full border shadow-lg transition ${
            hasNewMessages
              ? "border-neon-400/70 bg-neon-500/90 text-ink-950 shadow-glow"
              : "border-ink-600 bg-ink-900/80 text-ink-200 hover:border-ink-400"
          }`}
          aria-label="Scroll to latest"
          title="Scroll to latest"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}
