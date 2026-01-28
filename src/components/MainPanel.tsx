import type {
  ApprovalRequest,
  ChatMessage,
  FileChangeEntry,
  PermissionMode,
  ReviewTargetType,
  ToolTimelineItem,
} from "../types";
import { ApprovalPanel } from "./ApprovalPanel";
import { ChatHistory } from "./ChatHistory";
import { Composer } from "./Composer";

type MainPanelProps = {
  selectedRepoName: string | null;
  selectedRepoPath: string | null;
  running: boolean;
  activeTurnId: string | null;
  messages: ChatMessage[];
  toolItems: ToolTimelineItem[];
  fileChanges: Record<string, FileChangeEntry>;
  approvals: ApprovalRequest[];
  inputText: string;
  reviewTargetType: ReviewTargetType;
  reviewBaseBranch: string;
  reviewCommitSha: string;
  reviewCustomInstructions: string;
  selectedThreadId: string | null;
  selectedRepoId: string | null;
  selectedModel: string | null;
  availableModels: string[] | undefined;
  permissionMode: PermissionMode;
  onInputTextChange: (value: string) => void;
  onReviewTargetTypeChange: (value: ReviewTargetType) => void;
  onReviewBaseBranchChange: (value: string) => void;
  onReviewCommitShaChange: (value: string) => void;
  onReviewCustomInstructionsChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onReviewStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onModelChange: (model: string | null) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onApprove: (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => void;
};

export function MainPanel({
  selectedRepoName,
  selectedRepoPath,
  running,
  activeTurnId,
  messages,
  toolItems,
  fileChanges,
  approvals,
  inputText,
  reviewTargetType,
  reviewBaseBranch,
  reviewCommitSha,
  reviewCustomInstructions,
  selectedThreadId,
  selectedRepoId,
  selectedModel,
  availableModels,
  permissionMode,
  onInputTextChange,
  onReviewTargetTypeChange,
  onReviewBaseBranchChange,
  onReviewCommitShaChange,
  onReviewCustomInstructionsChange,
  onSend,
  onReviewStart,
  onStop,
  onModelChange,
  onPermissionModeChange,
  onApprove,
}: MainPanelProps) {
  return (
    <main className="flex-1 min-h-0 rounded-2xl border border-ink-700 bg-ink-900/60 shadow-panel flex flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
        <p className="text-lg font-semibold text-ink-100">
          {selectedRepoName ?? "Select a repo"}
        </p>
        <p
          className={`text-sm font-semibold ${running ? "text-neon-500" : "text-ink-300"}`}
        >
          {running ? "running" : "idle"}
        </p>
      </div>

      <ChatHistory
        messages={messages}
        toolItems={toolItems}
        selectedThreadId={selectedThreadId}
        selectedRepoPath={selectedRepoPath}
      />

      <ApprovalPanel
        approvals={approvals}
        fileChanges={fileChanges}
        selectedRepoId={selectedRepoId}
        selectedRepoPath={selectedRepoPath}
        onApprove={onApprove}
      />

      <Composer
        inputText={inputText}
        reviewTargetType={reviewTargetType}
        reviewBaseBranch={reviewBaseBranch}
        reviewCommitSha={reviewCommitSha}
        reviewCustomInstructions={reviewCustomInstructions}
        selectedThreadId={selectedThreadId}
        running={running}
        activeTurnId={activeTurnId}
        selectedModel={selectedModel}
        availableModels={availableModels}
        permissionMode={permissionMode}
        onInputTextChange={onInputTextChange}
        onReviewTargetTypeChange={onReviewTargetTypeChange}
        onReviewBaseBranchChange={onReviewBaseBranchChange}
        onReviewCommitShaChange={onReviewCommitShaChange}
        onReviewCustomInstructionsChange={onReviewCustomInstructionsChange}
        onSend={onSend}
        onReviewStart={onReviewStart}
        onStop={onStop}
        onModelChange={onModelChange}
        onPermissionModeChange={onPermissionModeChange}
      />
    </main>
  );
}
