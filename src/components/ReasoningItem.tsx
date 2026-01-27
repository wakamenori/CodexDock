import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types";

const TITLE_LIMIT = 80;

const stripMarkdown = (value: string) => {
  let result = value.replace(/`+/g, "");
  result = result.replace(/^\s*(?:[#>*+-]|\d+\.)\s+/, "");
  result = result.replace(/^\s*[*_~]+/, "");
  result = result.replace(/[*_~]+\s*$/g, "");
  return result.trim();
};

const truncateTitle = (value: string) =>
  value.length > TITLE_LIMIT ? `${value.slice(0, TITLE_LIMIT - 3)}...` : value;

const getTitleAndBody = (summary: string, content: string) => {
  const source = summary.trim() ? summary : content;
  const lines = source.split(/\r?\n/);
  let titleLine = "";
  let bodyLines: string[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line.trim()) {
      titleLine = line;
      bodyLines = lines.slice(idx + 1);
      break;
    }
  }
  const title = truncateTitle(stripMarkdown(titleLine || "Reasoning"));
  const body = bodyLines.join("\n").trim();
  return { title, body };
};

type ReasoningItemProps = {
  message: ChatMessage;
};

export function ReasoningItem({ message }: ReasoningItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const summary = message.summary ?? "";
  const content = message.content ?? "";
  const summaryPartsRaw = message.summaryParts ?? [];
  const contentPartsRaw = message.contentParts ?? [];
  const summaryPartsDisplay = summaryPartsRaw.filter((part) => part.trim());
  const contentPartsDisplay = contentPartsRaw.filter((part) => part.trim());
  const summaryText = summaryPartsDisplay.length
    ? summaryPartsDisplay.join("\n\n")
    : summary;
  const contentText = contentPartsDisplay.length
    ? contentPartsDisplay.join("\n\n")
    : content;
  const summaryCount =
    summaryPartsRaw.length > 0 ? summaryPartsRaw.length : summary ? 1 : 0;
  const contentCount =
    contentPartsRaw.length > 0 ? contentPartsRaw.length : content ? 1 : 0;
  const { title, body } = useMemo(
    () => getTitleAndBody(summaryText, contentText),
    [summaryText, contentText],
  );

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/70 px-4 py-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink-600 text-ink-300">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M9 4.5c-2.5 0-4.5 2-4.5 4.5 0 1.7.9 3.1 2.2 3.9-.4.7-.7 1.5-.7 2.6 0 2.5 2 4.5 4.5 4.5h1.5v-3H10.5c-.9 0-1.5-.6-1.5-1.5s.6-1.5 1.5-1.5H12V9H9c-.9 0-1.5-.6-1.5-1.5S8.1 6 9 6h3V4.5H9Z" />
              <path d="M15 4.5c2.5 0 4.5 2 4.5 4.5 0 1.7-.9 3.1-2.2 3.9.4.7.7 1.5.7 2.6 0 2.5-2 4.5-4.5 4.5H12v-3h1.5c.9 0 1.5-.6 1.5-1.5s-.6-1.5-1.5-1.5H12V9h3c.9 0 1.5-.6 1.5-1.5S15.9 6 15 6h-3V4.5h3Z" />
            </svg>
          </span>
          <p className="text-sm font-semibold text-ink-100">{title}</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-ink-400">
          {(summaryCount > 0 || contentCount > 0) && (
            <span>
              {summaryCount > 0 ? `summary ${summaryCount}` : "summary 0"}
              {contentCount > 0 ? ` • raw ${contentCount}` : ""}
            </span>
          )}
          <span>{expanded ? "hide" : "show"}</span>
        </div>
      </button>
      {!expanded && body && (
        <div className="mt-3 text-xs text-ink-300 markdown reasoning-clamp">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      )}
      {expanded && (
        <div className="mt-3 grid gap-3">
          {(summaryPartsDisplay.length > 0 || summary) && (
            <div className="grid gap-1">
              {(summaryPartsDisplay.length > 0
                ? summaryPartsDisplay
                : summary
                  ? [summary]
                  : []
              ).map((part, index) => (
                <div
                  key={`summary-${message.id}-${index}`}
                  className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2"
                >
                  <div className="text-xs text-ink-300 markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {part}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(contentPartsDisplay.length > 0 || content) && (
            <div className="grid gap-2">
              <button
                type="button"
                className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2 text-left text-[10px] uppercase tracking-[0.2em] text-ink-400"
                onClick={() => setShowRaw((current) => !current)}
                aria-expanded={showRaw}
              >
                <span>raw reasoning</span>
                <span>{showRaw ? "hide" : "show"}</span>
              </button>
              {showRaw && (
                <div className="grid gap-2">
                  {(contentPartsDisplay.length > 0
                    ? contentPartsDisplay
                    : content
                      ? [content]
                      : []
                  ).map((part, index) => (
                    <div
                      key={`content-${message.id}-${index}`}
                      className="rounded-lg border border-ink-800 bg-ink-900/50 px-3 py-2"
                    >
                      <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-ink-500">
                        block {index + 1}
                      </p>
                      <div className="text-xs text-ink-300 markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {part}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
