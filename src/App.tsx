import { Toaster } from "sonner";
import { HeaderBar } from "./components/HeaderBar";
import { MainPanel } from "./components/MainPanel";
import { Sidebar } from "./components/Sidebar";
import { useConversationState } from "./modules/conversation/ui/useConversationState";

export default function App() {
  const {
    repoGroups,
    threadUiStatusByThread,
    selectedRepoId,
    selectedRepo,
    selectedThreadId,
    wsConnected,
    running,
    activeTurnId,
    messages,
    toolItems,
    fileChanges,
    approvals,
    inputText,
    attachedImages,
    reviewTargetType,
    reviewBaseBranch,
    reviewCommitSha,
    reviewCustomInstructions,
    selectedModel,
    availableModels,
    selectedReasoningEffort,
    availableReasoningEfforts,
    permissionMode,
    selectRepo,
    setInputText,
    setReviewTargetType,
    setReviewBaseBranch,
    setReviewCommitSha,
    setReviewCustomInstructions,
    handleAddRepo,
    handleCreateThread,
    handleSelectThread,
    handleModelChange,
    handleReasoningEffortChange,
    handlePermissionModeChange,
    handleApprove,
    handleSend,
    handleAddImages,
    handleRemoveImage,
    handleReviewStart,
    handleStop,
  } = useConversationState();

  return (
    <div className="h-screen flex flex-col gap-4 p-4 overflow-hidden">
      <Toaster richColors theme="dark" position="top-right" />
      <HeaderBar wsConnected={wsConnected} />
      <div className="flex flex-1 min-h-0 gap-4">
        <Sidebar
          repoGroups={repoGroups}
          threadUiStatusByThread={threadUiStatusByThread}
          selectedRepoId={selectedRepoId}
          running={running}
          selectedThreadId={selectedThreadId}
          onSelectRepo={selectRepo}
          onAddRepo={handleAddRepo}
          onCreateThread={handleCreateThread}
          onSelectThread={handleSelectThread}
        />
        <MainPanel
          selectedRepoName={selectedRepo?.name ?? null}
          running={running}
          activeTurnId={activeTurnId}
          messages={messages}
          toolItems={toolItems}
          fileChanges={fileChanges}
          approvals={approvals}
          inputText={inputText}
          attachedImages={attachedImages}
          reviewTargetType={reviewTargetType}
          reviewBaseBranch={reviewBaseBranch}
          reviewCommitSha={reviewCommitSha}
          reviewCustomInstructions={reviewCustomInstructions}
          selectedThreadId={selectedThreadId}
          selectedRepoId={selectedRepoId}
          selectedRepoPath={selectedRepo?.path ?? null}
          selectedModel={selectedModel}
          availableModels={availableModels}
          selectedReasoningEffort={selectedReasoningEffort}
          availableReasoningEfforts={availableReasoningEfforts}
          permissionMode={permissionMode}
          onInputTextChange={(value) => setInputText(value)}
          onReviewTargetTypeChange={setReviewTargetType}
          onReviewBaseBranchChange={setReviewBaseBranch}
          onReviewCommitShaChange={setReviewCommitSha}
          onReviewCustomInstructionsChange={setReviewCustomInstructions}
          onSend={handleSend}
          onAddImages={handleAddImages}
          onRemoveImage={handleRemoveImage}
          onReviewStart={handleReviewStart}
          onStop={handleStop}
          onModelChange={handleModelChange}
          onReasoningEffortChange={handleReasoningEffortChange}
          onPermissionModeChange={handlePermissionModeChange}
          onApprove={handleApprove}
        />
      </div>
    </div>
  );
}
