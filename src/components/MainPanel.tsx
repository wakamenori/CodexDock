import type {
  ApprovalRequest,
  ChatMessage,
  FileChangeEntry,
  PermissionMode,
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
  fileChanges: Record<string, FileChangeEntry>;
  approvals: ApprovalRequest[];
  inputText: string;
  selectedThreadId: string | null;
  selectedRepoId: string | null;
  selectedModel: string | null;
  availableModels: string[] | undefined;
  permissionMode: PermissionMode;
  onInputTextChange: (value: string) => void;
  onSend: () => void | Promise<void>;
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
  fileChanges,
  approvals,
  inputText,
  selectedThreadId,
  selectedRepoId,
  selectedModel,
  availableModels,
  permissionMode,
  onInputTextChange,
  onSend,
  onStop,
  onModelChange,
  onPermissionModeChange,
  onApprove,
}: MainPanelProps) {
  return (
    <main className="flex-1 min-h-0 rounded-2xl border border-ink-700 bg-ink-900/60 shadow-panel flex flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
            Active Repo
          </p>
          <p className="text-lg font-semibold text-ink-100">
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
        messages={messages}
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
        selectedThreadId={selectedThreadId}
        running={running}
        activeTurnId={activeTurnId}
        selectedModel={selectedModel}
        availableModels={availableModels}
        permissionMode={permissionMode}
        onInputTextChange={onInputTextChange}
        onSend={onSend}
        onStop={onStop}
        onModelChange={onModelChange}
        onPermissionModeChange={onPermissionModeChange}
      />
    </main>
  );
}
