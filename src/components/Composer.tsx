import { useState } from "react";
import { toast } from "sonner";

import {
  normalizePermissionMode,
  PERMISSION_MODE_OPTIONS,
} from "../modules/conversation/domain/permissionMode";
import { useConversationCommands } from "../modules/conversation/provider/useConversationCommands";
import { useConversationSelector } from "../modules/conversation/provider/useConversationSelector";
import {
  selectAvailableModels,
  selectFocusedModel,
  selectFocusedThreadActiveTurnId,
  selectFocusedThreadId,
  selectFocusedThreadRunning,
  selectPermissionMode,
} from "../modules/conversation/store/selectors";
import type { ReviewTargetType } from "../types";

export function Composer() {
  const [inputText, setInputText] = useState("");
  const [reviewTargetType, setReviewTargetType] =
    useState<ReviewTargetType>("uncommittedChanges");
  const [reviewBaseBranch, setReviewBaseBranch] = useState("");
  const [reviewCommitSha, setReviewCommitSha] = useState("");
  const [reviewCustomInstructions, setReviewCustomInstructions] = useState("");

  const selectedThreadId = useConversationSelector(selectFocusedThreadId);
  const running = useConversationSelector(selectFocusedThreadRunning);
  const activeTurnId = useConversationSelector(selectFocusedThreadActiveTurnId);
  const selectedModel = useConversationSelector(selectFocusedModel);
  const availableModels = useConversationSelector(selectAvailableModels);
  const permissionMode = useConversationSelector(selectPermissionMode);
  const {
    sendMessage,
    startReview,
    stopActiveTurn,
    updateModel,
    updatePermissionMode,
  } = useConversationCommands();

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

  const handleSend = async () => {
    if (!selectedThreadId) return;
    const text = inputText;
    setInputText("");
    await sendMessage(text);
  };

  const buildReviewTarget = () => {
    if (reviewTargetType === "uncommittedChanges") {
      return { type: "uncommittedChanges" } as const;
    }
    if (reviewTargetType === "baseBranch") {
      const branch = reviewBaseBranch.trim();
      if (!branch) return null;
      return { type: "baseBranch", branch } as const;
    }
    if (reviewTargetType === "commit") {
      const sha = reviewCommitSha.trim();
      if (!sha) return null;
      return { type: "commit", sha } as const;
    }
    if (reviewTargetType === "custom") {
      const instructions = reviewCustomInstructions.trim();
      if (!instructions) return null;
      return { type: "custom", instructions } as const;
    }
    return null;
  };

  const handleReview = async () => {
    const target = buildReviewTarget();
    if (!target) {
      toast.error("Review target is not set");
      return;
    }
    await startReview(target);
  };

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
              setReviewTargetType(event.target.value as ReviewTargetType)
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
              onChange={(event) => setReviewBaseBranch(event.target.value)}
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
              onChange={(event) => setReviewCommitSha(event.target.value)}
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
                setReviewCustomInstructions(event.target.value)
              }
              disabled={!selectedThreadId || running}
              type="text"
            />
          )}
          <button
            className="rounded-md border border-neon-500/60 px-3 py-1 text-xs font-semibold text-neon-200 disabled:opacity-40"
            onClick={() => void handleReview()}
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
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            const isComposing =
              event.nativeEvent.isComposing || event.key === "Process";
            const isSendShortcut = event.ctrlKey || event.metaKey;
            if (event.key !== "Enter" || !isSendShortcut || isComposing) return;
            event.preventDefault();
            if (running || !selectedThreadId || !inputText.trim()) return;
            void handleSend();
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
              onChange={(event) => updateModel(event.target.value || null)}
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
                updatePermissionMode(
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
              onClick={() => void stopActiveTurn()}
              disabled={!running || !activeTurnId}
              type="button"
            >
              Stop
            </button>
            <button
              className="rounded-md bg-neon-500/90 px-4 py-2 text-xs font-semibold text-ink-900 disabled:opacity-50"
              onClick={() => void handleSend()}
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
