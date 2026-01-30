import { Search, Terminal } from "lucide-react";
import { useMemo } from "react";
import { toRelativePath } from "../shared/paths";
import type { JsonValue, ToolTimelineItem } from "../types";
import { DiffViewer } from "./DiffViewer";

type ToolCallCardProps = {
  item: ToolTimelineItem;
  selectedRepoPath: string | null;
};

const formatJson = (value: JsonValue | undefined): string | null => {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatStatus = (status?: string) => {
  if (!status) return { label: "pending", tone: "text-amber-300" };
  const normalized = status.toLowerCase();
  if (normalized === "completed") {
    return { label: "completed", tone: "text-neon-300" };
  }
  if (normalized === "failed" || normalized === "declined") {
    return { label: normalized, tone: "text-red-300" };
  }
  return { label: normalized, tone: "text-amber-300" };
};

const statusVariant = (status?: string) => {
  if (!status) {
    return { label: "pending", dot: "bg-amber-400/80", isFailed: false };
  }
  const normalized = status.toLowerCase();
  if (normalized === "completed") {
    return { label: "completed", dot: "bg-neon-400", isFailed: false };
  }
  if (normalized === "failed" || normalized === "declined") {
    return { label: normalized, dot: "bg-red-400", isFailed: true };
  }
  return { label: normalized, dot: "bg-amber-400/80", isFailed: false };
};

const labelForTool = (item: ToolTimelineItem) => {
  if (item.type === "mcpToolCall" && item.tool) {
    return `${item.type} · ${item.tool}`;
  }
  if (
    (item.type === "collabToolCall" || item.type === "collabAgentToolCall") &&
    item.tool
  ) {
    return `${item.type} · ${item.tool}`;
  }
  return item.type;
};

const getSearchQuery = (item: ToolTimelineItem): string | null => {
  if (item.query) return item.query;
  const input = item.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (typeof record.query === "string") return record.query;
  }
  return null;
};

const stripShellWrapper = (command: string) => {
  const prefixes = ["/bin/zsh -lc ", "/bin/bash -lc "];
  const prefix = prefixes.find((entry) => command.startsWith(entry));
  if (!prefix) return command;
  const raw = command.slice(prefix.length).trim();
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
};

export function ToolCallCard({ item, selectedRepoPath }: ToolCallCardProps) {
  const statusMeta = formatStatus(item.status);
  const statusStyle = statusVariant(item.status);
  const outputText = useMemo(() => {
    if (item.type !== "commandExecution") return null;
    return item.aggregatedOutput ?? item.outputStream ?? "";
  }, [item]);

  const showMetaHeader =
    item.type !== "commandExecution" && item.type !== "fileChange";
  const showToolLabel =
    item.type !== "webSearch" &&
    item.type !== "commandExecution" &&
    item.type !== "fileChange";
  const searchQuery = item.type === "webSearch" ? getSearchQuery(item) : null;
  const jsonInput = formatJson(item.input);
  const jsonOutput = formatJson(item.output);
  const jsonError = formatJson(item.error);
  const commandText = item.command ? stripShellWrapper(item.command) : null;

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[85%] rounded-xl border px-4 py-3 ${statusStyle.isFailed ? "border-red-500/40 bg-red-950/20" : "border-ink-700 bg-ink-800/70"}`}
      >
        {showMetaHeader && (
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-ink-400">
              Tool
            </p>
            <p
              className={`text-xs uppercase tracking-[0.2em] ${statusMeta.tone}`}
            >
              {statusMeta.label}
            </p>
          </div>
        )}
        {showToolLabel && (
          <p className="text-sm font-semibold text-ink-100">
            {labelForTool(item)}
          </p>
        )}

        {item.type === "commandExecution" && (
          <div className="mt-3 grid gap-2">
            <div className="flex items-start gap-2 rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2">
              <span
                className={`mt-1 h-2.5 w-2.5 rounded-full ${statusStyle.dot}`}
                title={statusStyle.label}
              />
              <div className="flex items-start gap-2">
                <Terminal
                  className="mt-0.5 h-4 w-4 text-ink-400"
                  aria-hidden="true"
                />
                <span className="whitespace-pre-wrap break-words text-xs font-mono text-ink-200">
                  {commandText ?? "(command unavailable)"}
                </span>
              </div>
            </div>
            {outputText && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                {outputText}
              </pre>
            )}
            {(item.exitCode != null && item.exitCode !== 0) ||
            item.durationMs != null ? (
              <p className="text-xs text-ink-400">
                {item.exitCode != null && item.exitCode !== 0 && (
                  <>
                    exit: {item.exitCode}
                    {item.durationMs != null ? " · " : null}
                  </>
                )}
                {item.durationMs != null && <>{item.durationMs}ms</>}
              </p>
            ) : null}
          </div>
        )}

        {item.type === "fileChange" && (
          <div className="mt-3 grid gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/60 px-2.5 py-1 text-[11px] uppercase tracking-[0.15em] text-ink-300">
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`}
                title={statusStyle.label}
              />
              {statusMeta.label}
            </div>
            {item.changes?.length ? (
              item.changes.map((change, index) => (
                <div
                  key={`${item.itemId}-${change.path}-${index}`}
                  className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2"
                >
                  <p className="text-xs font-semibold text-ink-100">
                    {toRelativePath(change.path || "", selectedRepoPath) ||
                      "(unknown file)"}
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
              <p className="text-xs text-ink-400">diff unavailable.</p>
            )}
          </div>
        )}

        {item.type !== "commandExecution" && item.type !== "fileChange" && (
          <div className="mt-3 grid gap-3">
            {item.progressMessages && item.progressMessages.length > 0 && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                {item.progressMessages.join("\n")}
              </pre>
            )}
            {item.type === "webSearch" && (
              <div className="rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                <div className="flex items-start gap-2">
                  <Search
                    className="mt-0.5 h-4 w-4 text-ink-400"
                    aria-hidden="true"
                  />
                  <span className="whitespace-pre-wrap break-words">
                    {searchQuery ?? "(query unavailable)"}
                  </span>
                </div>
              </div>
            )}
            {jsonInput && item.type !== "webSearch" && (
              <div className="grid gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-ink-400">
                  input
                </p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                  {jsonInput}
                </pre>
              </div>
            )}
            {jsonOutput && (
              <div className="grid gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-ink-400">
                  output
                </p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                  {jsonOutput}
                </pre>
              </div>
            )}
            {jsonError && (
              <div className="grid gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-ink-400">
                  error
                </p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-red-200">
                  {jsonError}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
