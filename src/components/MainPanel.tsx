import type { ApprovalRequest, ChatMessage, DiffEntry } from "../types";
import { ApprovalPanel } from "./ApprovalPanel";
import { ChatHistory } from "./ChatHistory";
import { Composer } from "./Composer";

type MainPanelProps = {
  selectedRepoName: string | null;
  running: boolean;
  errorMessage: string | null;
  messages: ChatMessage[];
  diffs: DiffEntry[];
  approvals: ApprovalRequest[];
  inputText: string;
  selectedThreadId: string | null;
  selectedRepoId: string | null;
  onInputTextChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onApprove: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
};

export function MainPanel({
  selectedRepoName,
  running,
  errorMessage,
  messages,
  diffs,
  approvals,
  inputText,
  selectedThreadId,
  selectedRepoId,
  onInputTextChange,
  onSend,
  onApprove,
}: MainPanelProps) {
  return (
    <main className="flex-1 min-h-0 rounded-2xl border border-ink-700 bg-ink-900/60 shadow-panel flex flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
            Active Repo
          </p>
          <p className="text-lg font-semibold text-white">
            {selectedRepoName ?? "Select a repo"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-300">State</p>
          <p
            className={`text-sm font-semibold ${running ? "text-neon-500" : "text-ink-300"}`}
          >
            {running ? "running" : "idle"}
          </p>
        </div>
      </div>

      <ChatHistory
        errorMessage={errorMessage}
        messages={messages}
        diffs={diffs}
        selectedThreadId={selectedThreadId}
      />

      <ApprovalPanel
        approvals={approvals}
        selectedRepoId={selectedRepoId}
        onApprove={onApprove}
      />

      <Composer
        inputText={inputText}
        selectedThreadId={selectedThreadId}
        running={running}
        onInputTextChange={onInputTextChange}
        onSend={onSend}
      />
    </main>
  );
}
