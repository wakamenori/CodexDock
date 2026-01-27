import {
  normalizePermissionMode,
  PERMISSION_MODE_OPTIONS,
} from "../modules/conversation/domain/permissionMode";
import type { PermissionMode, ReviewTargetType } from "../types";

type ComposerProps = {
  inputText: string;
  reviewTargetType: ReviewTargetType;
  reviewBaseBranch: string;
  reviewCommitSha: string;
  reviewCustomInstructions: string;
  selectedThreadId: string | null;
  running: boolean;
  activeTurnId: string | null;
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
};

export function Composer({
  inputText,
  reviewTargetType,
  reviewBaseBranch,
  reviewCommitSha,
  reviewCustomInstructions,
  selectedThreadId,
  running,
  activeTurnId,
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
}: ComposerProps) {
  const normalizedModel = selectedModel ?? "";
  const modelOptions = availableModels ?? [];
  const displayModels = normalizedModel
    ? Array.from(new Set([normalizedModel, ...modelOptions]))
    : modelOptions;
  const reviewReady =
    reviewTargetType === "uncommittedChanges" ||
    (reviewTargetType === "baseBranch" && reviewBaseBranch.trim().length > 0) ||
    (reviewTargetType === "commit" && reviewCommitSha.trim().length > 0) ||
    (reviewTargetType === "custom" &&
      reviewCustomInstructions.trim().length > 0);
  const reviewDisabled = !selectedThreadId || running || !reviewReady;

  return (
    <div className="border-t border-ink-700 px-6 py-4">
      <div className="rounded-xl border border-ink-700 bg-ink-800/70 px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-300">
          <span className="text-xs font-semibold text-ink-200">Review</span>
          <select
            aria-label="Review target"
            className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            value={reviewTargetType}
            onChange={(event) =>
              onReviewTargetTypeChange(event.target.value as ReviewTargetType)
            }
            disabled={!selectedThreadId || running}
          >
            <option value="uncommittedChanges">uncommitted</option>
            <option value="baseBranch">base branch</option>
            <option value="commit">commit</option>
            <option value="custom">custom</option>
          </select>
          {reviewTargetType === "baseBranch" && (
            <input
              aria-label="Base branch"
              className="min-w-[140px] flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500"
              placeholder="branch (e.g. main)"
              value={reviewBaseBranch}
              onChange={(event) => onReviewBaseBranchChange(event.target.value)}
              disabled={!selectedThreadId || running}
              type="text"
            />
          )}
          {reviewTargetType === "commit" && (
            <input
              aria-label="Commit SHA"
              className="min-w-[180px] flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500"
              placeholder="commit sha"
              value={reviewCommitSha}
              onChange={(event) => onReviewCommitShaChange(event.target.value)}
              disabled={!selectedThreadId || running}
              type="text"
            />
          )}
          {reviewTargetType === "custom" && (
            <input
              aria-label="Review instructions"
              className="min-w-[220px] flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500"
              placeholder="instructions"
              value={reviewCustomInstructions}
              onChange={(event) =>
                onReviewCustomInstructionsChange(event.target.value)
              }
              disabled={!selectedThreadId || running}
              type="text"
            />
          )}
          <button
            className="rounded-md border border-neon-500/60 px-3 py-1 text-xs font-semibold text-neon-200 disabled:opacity-40"
            onClick={onReviewStart}
            disabled={reviewDisabled}
            type="button"
          >
            Review
          </button>
        </div>
        <textarea
          className="h-28 w-full resize-none bg-transparent text-sm text-ink-200 outline-none placeholder:text-ink-300"
          placeholder={
            selectedThreadId
              ? "Describe what you want to build..."
              : "Select or create a thread"
          }
          value={inputText}
          onChange={(event) => onInputTextChange(event.target.value)}
          onKeyDown={(event) => {
            const isComposing =
              event.nativeEvent.isComposing || event.key === "Process";
            const isSendShortcut = event.ctrlKey || event.metaKey;
            if (event.key !== "Enter" || !isSendShortcut || isComposing) return;
            event.preventDefault();
            if (running || !selectedThreadId || !inputText.trim()) return;
            void onSend();
          }}
          disabled={!selectedThreadId}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300">
          <span>{running ? "Streaming..." : null}</span>
          <div className="flex items-center gap-3">
            <select
              aria-label="Model"
              className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              value={normalizedModel}
              onChange={(event) => onModelChange(event.target.value || null)}
              disabled={!selectedThreadId}
            >
              <option value="" disabled>
                Unset
              </option>
              {displayModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <select
              aria-label="Permission"
              className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              value={permissionMode}
              onChange={(event) =>
                onPermissionModeChange(
                  normalizePermissionMode(event.target.value),
                )
              }
            >
              {PERMISSION_MODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
            <button
              className="rounded-md border border-ink-600 px-3 py-2 text-xs font-semibold text-ink-100 disabled:opacity-50"
              onClick={onStop}
              disabled={!running || !activeTurnId}
              type="button"
            >
              Stop
            </button>
            <button
              className="rounded-md bg-neon-500/90 px-4 py-2 text-xs font-semibold text-ink-900 disabled:opacity-50"
              onClick={onSend}
              disabled={!selectedThreadId || running || !inputText.trim()}
              type="button"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
