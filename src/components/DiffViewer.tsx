import { useMemo } from "react";
import { parseDiffLines, type DiffLine } from "../diff";

type DiffViewerProps = {
  diffText: string;
};

const getDisplayNumber = (line: DiffLine): number | null => {
  if (line.type === "add") return line.newNumber;
  if (line.type === "del") return line.oldNumber;
  if (line.type === "context") return line.newNumber ?? line.oldNumber;
  return null;
};

const getRowStyle = (line: DiffLine): string => {
  if (line.type === "add") return "bg-emerald-500/10 text-emerald-300";
  if (line.type === "del") return "bg-red-500/10 text-red-300";
  if (line.type === "note") return "text-ink-400";
  return "text-ink-200";
};

export function DiffViewer({ diffText }: DiffViewerProps) {
  const lines = useMemo(() => parseDiffLines(diffText), [diffText]);

  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-lg bg-ink-900/70 p-2 text-xs font-mono">
      {lines.map((line) => {
        const displayNumber = getDisplayNumber(line);
        return (
          <div
            key={line.id}
            className={`grid grid-cols-[3.5rem,1fr] gap-2 rounded px-1 py-0.5 ${getRowStyle(
              line,
            )}`}
          >
            <span className="text-right text-ink-500">
              {displayNumber ?? ""}
            </span>
            <span className="whitespace-pre">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}
