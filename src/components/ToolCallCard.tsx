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

export function ToolCallCard({ item, selectedRepoPath }: ToolCallCardProps) {
  const statusMeta = formatStatus(item.status);
  const outputText = useMemo(() => {
    if (item.type !== "commandExecution") return null;
    return item.aggregatedOutput ?? item.outputStream ?? "";
  }, [item]);

  const jsonInput = formatJson(item.input);
  const jsonOutput = formatJson(item.output);
  const jsonError = formatJson(item.error);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl border border-ink-700 bg-ink-800/70 px-4 py-3">
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
        <p className="text-sm font-semibold text-ink-100">
          {labelForTool(item)}
        </p>

        {item.type === "commandExecution" && (
          <div className="mt-3 grid gap-2">
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
              {item.command ?? "(command unavailable)"}
            </pre>
            <p className="text-xs text-ink-400">
              cwd:{" "}
              {item.cwd
                ? toRelativePath(item.cwd, selectedRepoPath)
                : "(unknown)"}
            </p>
            {outputText && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                {outputText}
              </pre>
            )}
            {(item.exitCode !== null || item.durationMs !== null) && (
              <p className="text-xs text-ink-400">
                exit: {item.exitCode ?? "(unknown)"} · duration:{" "}
                {item.durationMs ?? "(unknown)"}ms
              </p>
            )}
          </div>
        )}

        {item.type === "fileChange" && (
          <div className="mt-3 grid gap-3">
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
            {item.outputStream && (
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                {item.outputStream}
              </pre>
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
            {jsonInput && (
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
