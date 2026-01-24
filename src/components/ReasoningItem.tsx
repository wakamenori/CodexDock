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
  const [expanded, setExpanded] = useState(false);
  const summary = message.summary ?? "";
  const content = message.content ?? "";
  const { title, body } = useMemo(
    () => getTitleAndBody(summary, content),
    [summary, content],
  );

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/70 px-4 py-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-ink-400">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink-600 text-ink-300">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path
                  d="M9 4.5c-2.5 0-4.5 2-4.5 4.5 0 1.7.9 3.1 2.2 3.9-.4.7-.7 1.5-.7 2.6 0 2.5 2 4.5 4.5 4.5h1.5v-3H10.5c-.9 0-1.5-.6-1.5-1.5s.6-1.5 1.5-1.5H12V9H9c-.9 0-1.5-.6-1.5-1.5S8.1 6 9 6h3V4.5H9Z"
                />
                <path
                  d="M15 4.5c2.5 0 4.5 2 4.5 4.5 0 1.7-.9 3.1-2.2 3.9.4.7.7 1.5.7 2.6 0 2.5-2 4.5-4.5 4.5H12v-3h1.5c.9 0 1.5-.6 1.5-1.5s-.6-1.5-1.5-1.5H12V9h3c.9 0 1.5-.6 1.5-1.5S15.9 6 15 6h-3V4.5h3Z"
                />
              </svg>
            </span>
            <span>Reasoning</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-ink-100">
            {title}
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-ink-400">
          {expanded ? "hide" : "show"}
        </span>
      </button>
      {body && (
        <div
          className={`mt-3 text-xs text-ink-200 markdown ${
            expanded ? "" : "reasoning-clamp"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
