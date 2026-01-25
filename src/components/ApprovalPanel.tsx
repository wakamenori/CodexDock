import { normalizeRootPath } from "../shared/paths";
import { asRecord } from "../shared/records";
import type { ApprovalRequest, FileChangeEntry } from "../types";
import { DiffViewer } from "./DiffViewer";

type ApprovalPanelProps = {
  approvals: ApprovalRequest[];
  fileChanges: Record<string, FileChangeEntry>;
  selectedRepoId: string | null;
  selectedRepoPath: string | null;
  onApprove: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
};

const toRelativePath = (path: string, repoRoot: string | null) => {
  const normalized = path.replace(/\\/g, "/");
  const root = normalizeRootPath(repoRoot ?? "");
  if (root && normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  const withoutDrive = normalized.replace(/^[A-Za-z]:/, "");
  return withoutDrive.replace(/^\/+/, "").replace(/^\.\/+/, "");
};

const formatCommand = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(" ");
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const formatParsedCmd = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const display = record?.display;
  if (typeof display === "string") return display;
  const tokens =
    record?.tokens ??
    record?.argv ??
    record?.args ??
    record?.segments ??
    record?.parts;
  if (Array.isArray(tokens)) {
    return tokens.map((entry) => String(entry)).join(" ");
  }
  return null;
};

const extractCommandText = (params: unknown): string | null => {
  if (typeof params === "string") return params;
  const record = asRecord(params);
  if (!record) return null;
  return (
    formatParsedCmd(record.parsedCmd) ?? formatCommand(record.command) ?? null
  );
};

const extractCwd = (params: unknown): string | null => {
  const record = asRecord(params);
  if (!record) return null;
  const cwd = record.cwd;
  return typeof cwd === "string" ? cwd : null;
};

export function ApprovalPanel({
  approvals,
  fileChanges,
  selectedRepoId,
  selectedRepoPath,
  onApprove,
}: ApprovalPanelProps) {
  if (!approvals.length || !selectedRepoId) return null;

  return (
    <div className="border-t border-ink-700 bg-ink-800/60 px-6 py-4">
      <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
        Approval
      </p>
      <div className="mt-3 grid gap-3">
        {approvals.map((approval) => {
          const isFileChangeApproval =
            approval.method === "item/fileChange/requestApproval";
          const isCommandApproval =
            approval.method === "item/commandExecution/requestApproval";
          const fileChange =
            approval.itemId && fileChanges[approval.itemId]
              ? fileChanges[approval.itemId]
              : undefined;
          const commandText = isCommandApproval
            ? extractCommandText(approval.params)
            : null;
          const cwd = isCommandApproval ? extractCwd(approval.params) : null;
          const relativeCwd = cwd ? toRelativePath(cwd, selectedRepoPath) : "";
          return (
            <div
              key={String(approval.rpcId)}
              className="rounded-xl border border-ink-700 bg-ink-900/70 px-4 py-3"
            >
              {isFileChangeApproval && (
                <div className="grid gap-3">
                  {fileChange?.changes.length ? (
                    fileChange.changes.map((change, index) => (
                      <div
                        key={`${approval.rpcId}-${change.path}-${index}`}
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
                    <p className="text-xs text-ink-400">diff unavailable.</p>
                  )}
                </div>
              )}
              {isCommandApproval && (
                <div className="grid gap-2">
                  <p className="text-xs uppercase tracking-[0.15em] text-ink-400">
                    command
                  </p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/70 px-3 py-2 text-xs text-ink-200">
                    {commandText ?? "command unavailable."}
                  </pre>
                  {relativeCwd && (
                    <p className="text-xs text-ink-400">cwd: {relativeCwd}</p>
                  )}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  className="rounded-md bg-neon-500/90 px-3 py-2 text-xs font-semibold text-ink-900"
                  onClick={() => onApprove(selectedRepoId, approval, "accept")}
                  type="button"
                >
                  Apply
                </button>
                <button
                  className="rounded-md border border-ink-600 px-3 py-2 text-xs text-ink-200 hover:border-red-400"
                  onClick={() => onApprove(selectedRepoId, approval, "decline")}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
