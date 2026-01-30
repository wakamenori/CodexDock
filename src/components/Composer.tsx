import type { CSSProperties } from "react";
import { useRef } from "react";
import {
  normalizePermissionMode,
  PERMISSION_MODE_OPTIONS,
} from "../modules/conversation/domain/permissionMode";
import type {
  ImageAttachment,
  PermissionMode,
  ReasoningEffort,
  ReasoningEffortOption,
  ReviewTargetType,
  ThreadTokenUsage,
} from "../types";

type ComposerProps = {
  inputText: string;
  attachedImages: ImageAttachment[];
  reviewTargetType: ReviewTargetType;
  reviewBaseBranch: string;
  reviewCommitSha: string;
  reviewCustomInstructions: string;
  selectedThreadId: string | null;
  running: boolean;
  activeTurnId: string | null;
  selectedModel: string | null;
  availableModels: string[] | undefined;
  selectedReasoningEffort: ReasoningEffort | null;
  availableReasoningEfforts: ReasoningEffortOption[] | undefined;
  permissionMode: PermissionMode;
  contextUsage: ThreadTokenUsage | null;
  onInputTextChange: (value: string) => void;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onReviewTargetTypeChange: (value: ReviewTargetType) => void;
  onReviewBaseBranchChange: (value: string) => void;
  onReviewCommitShaChange: (value: string) => void;
  onReviewCustomInstructionsChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onReviewStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onModelChange: (model: string | null) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
};

export function Composer({
  inputText,
  attachedImages,
  reviewTargetType,
  reviewBaseBranch,
  reviewCommitSha,
  reviewCustomInstructions,
  selectedThreadId,
  running,
  activeTurnId,
  selectedModel,
  availableModels,
  selectedReasoningEffort,
  availableReasoningEfforts,
  permissionMode,
  contextUsage,
  onInputTextChange,
  onAddImages,
  onRemoveImage,
  onReviewTargetTypeChange,
  onReviewBaseBranchChange,
  onReviewCommitShaChange,
  onReviewCustomInstructionsChange,
  onSend,
  onReviewStart,
  onStop,
  onModelChange,
  onReasoningEffortChange,
  onPermissionModeChange,
}: ComposerProps) {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);
  const normalizedModel = selectedModel ?? "";
  const modelOptions = availableModels ?? [];
  const displayModels = normalizedModel
    ? Array.from(new Set([normalizedModel, ...modelOptions]))
    : modelOptions;
  const effortOptions = availableReasoningEfforts ?? [];
  const displayEfforts: ReasoningEffortOption[] = [];
  const seenEfforts = new Set<ReasoningEffort>();
  for (const option of effortOptions) {
    if (seenEfforts.has(option.effort)) continue;
    seenEfforts.add(option.effort);
    displayEfforts.push(option);
  }
  const selectedEffortValue =
    selectedReasoningEffort ?? displayEfforts[0]?.effort ?? "";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canSend =
    Boolean(selectedThreadId) &&
    !running &&
    (inputText.trim().length > 0 || attachedImages.length > 0);
  const reviewReady =
    reviewTargetType === "uncommittedChanges" ||
    (reviewTargetType === "baseBranch" && reviewBaseBranch.trim().length > 0) ||
    (reviewTargetType === "commit" && reviewCommitSha.trim().length > 0) ||
    (reviewTargetType === "custom" &&
      reviewCustomInstructions.trim().length > 0);
  const reviewDisabled = !selectedThreadId || running || !reviewReady;
  const contextWindow = contextUsage?.modelContextWindow ?? null;
  const lastTotalTokens = contextUsage?.last.totalTokens ?? 0;
  const totalTokens = contextUsage?.total.totalTokens ?? 0;
  const usedTokens = lastTotalTokens > 0 ? lastTotalTokens : totalTokens;
  const contextFreePercent =
    contextWindow && usedTokens > 0
      ? 100 - clamp((usedTokens / contextWindow) * 100, 0, 100)
      : null;
  const contextFreeLabel =
    contextFreePercent === null
      ? "Context free --"
      : `Context free ${Math.round(contextFreePercent)}%`;

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
        {attachedImages.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachedImages.map((image) => (
              <div
                key={image.id}
                className="relative overflow-hidden rounded-lg border border-ink-800 bg-ink-950/60"
              >
                <img
                  src={image.previewUrl}
                  alt={image.name || "attached image"}
                  className="h-20 w-28 object-cover"
                  loading="lazy"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-md bg-ink-900/80 px-1.5 py-0.5 text-[10px] text-ink-200 hover:text-ink-50 disabled:opacity-50"
                  onClick={() => onRemoveImage(image.id)}
                  disabled={running}
                  aria-label="Remove image"
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          className="h-28 w-full resize-none bg-transparent text-sm text-ink-200 outline-none placeholder:text-ink-300"
          placeholder={
            selectedThreadId
              ? "Describe what you want to build..."
              : "Select or create a thread"
          }
          value={inputText}
          onChange={(event) => onInputTextChange(event.target.value)}
          onPaste={(event) => {
            if (!selectedThreadId || running) return;
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            onAddImages(files);
          }}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (!selectedThreadId || running) return;
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return;
            onAddImages(files);
          }}
          onKeyDown={(event) => {
            const isComposing =
              event.nativeEvent.isComposing || event.key === "Process";
            const isSendShortcut = event.ctrlKey || event.metaKey;
            if (event.key !== "Enter" || !isSendShortcut || isComposing) return;
            event.preventDefault();
            if (!canSend) return;
            void onSend();
          }}
          disabled={!selectedThreadId}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300">
          <div className="flex items-center gap-3">
            <div className="context-meter" title={contextFreeLabel}>
              <span
                className={`context-ring ${contextFreePercent === null ? "is-empty" : ""}`}
                style={
                  {
                    "--context-free": contextFreePercent ?? 0,
                  } as CSSProperties
                }
                aria-hidden="true"
              />
              <span className="text-[11px] font-semibold text-ink-200">
                Context free{" "}
                <span className="text-ink-400">
                  {contextFreePercent === null
                    ? "--"
                    : `${Math.round(contextFreePercent)}%`}
                </span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0) {
                  onAddImages(files);
                }
                event.target.value = "";
              }}
              disabled={!selectedThreadId || running}
            />
            <button
              type="button"
              className="rounded-md border border-ink-600 px-3 py-2 text-xs font-semibold text-ink-100 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedThreadId || running}
            >
              Image
            </button>
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
              aria-label="Reasoning effort"
              className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              value={selectedEffortValue}
              onChange={(event) =>
                onReasoningEffortChange(event.target.value as ReasoningEffort)
              }
              disabled={!selectedThreadId || displayEfforts.length === 0}
            >
              {displayEfforts.map((option) => (
                <option key={option.effort} value={option.effort}>
                  {option.effort}
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
              disabled={!canSend}
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
