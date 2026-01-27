import { useConversationCommands } from "../modules/conversation/provider/useConversationCommands";
import { useConversationSelector } from "../modules/conversation/provider/useConversationSelector";
import {
  selectFocusedRepo,
  selectFocusedRepoId,
  selectFocusedThreadApprovals,
  selectFocusedThreadFileChanges,
  selectFocusedThreadId,
  selectFocusedThreadMessages,
  selectFocusedThreadRunning,
} from "../modules/conversation/store/selectors";
import type { ApprovalRequest } from "../types";
import { ApprovalPanel } from "./ApprovalPanel";
import { ChatHistory } from "./ChatHistory";
import { Composer } from "./Composer";

export function MainPanel() {
  const focusedRepo = useConversationSelector(selectFocusedRepo);
  const selectedRepoId = useConversationSelector(selectFocusedRepoId);
  const selectedThreadId = useConversationSelector(selectFocusedThreadId);
  const messages = useConversationSelector(selectFocusedThreadMessages);
  const fileChanges = useConversationSelector(selectFocusedThreadFileChanges);
  const approvals = useConversationSelector(selectFocusedThreadApprovals);
  const running = useConversationSelector(selectFocusedThreadRunning);
  const { approveRequest } = useConversationCommands();

  const handleApprove = (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => {
    if (!repoId) return;
    approveRequest(repoId, request, decision);
  };

  return (
    <main className="flex-1 min-h-0 rounded-2xl border border-ink-700 bg-ink-900/60 shadow-panel flex flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
        <p className="text-lg font-semibold text-ink-100">
          {focusedRepo?.name ?? "Select a repo"}
        </p>
        <p
          className={`text-sm font-semibold ${running ? "text-neon-500" : "text-ink-300"}`}
        >
          {running ? "running" : "idle"}
        </p>
      </div>

      <ChatHistory
        messages={messages}
        selectedThreadId={selectedThreadId}
        selectedRepoPath={focusedRepo?.path ?? null}
      />

      <ApprovalPanel
        approvals={approvals}
        fileChanges={fileChanges}
        selectedRepoId={selectedRepoId}
        selectedRepoPath={focusedRepo?.path ?? null}
        onApprove={handleApprove}
      />

      <Composer />
    </main>
  );
}
