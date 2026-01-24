import type { ApprovalRequest } from "../types";

type ApprovalPanelProps = {
  approvals: ApprovalRequest[];
  selectedRepoId: string | null;
  onApprove: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
};

export function ApprovalPanel({
  approvals,
  selectedRepoId,
  onApprove,
}: ApprovalPanelProps) {
  if (!approvals.length || !selectedRepoId) return null;

  return (
    <div className="border-t border-ink-700 bg-ink-800/60 px-6 py-4">
      <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
        Approval
      </p>
      <div className="mt-3 grid gap-3">
        {approvals.map((approval) => (
          <div
            key={String(approval.rpcId)}
            className="rounded-xl border border-ink-700 bg-ink-900/70 px-4 py-3"
          >
            <p className="text-sm font-semibold text-white">
              {approval.method}
            </p>
            <p className="mt-1 text-xs text-ink-300">
              item: {approval.itemId ?? "-"}
            </p>
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
        ))}
      </div>
    </div>
  );
}
