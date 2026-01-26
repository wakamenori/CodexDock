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
    fileChanges,
    approvals,
    inputText,
    selectedModel,
    availableModels,
    permissionMode,
    selectRepo,
    setInputText,
    handleAddRepo,
    handleCreateThread,
    handleSelectThread,
    handleModelChange,
    handlePermissionModeChange,
    handleApprove,
    handleSend,
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
          fileChanges={fileChanges}
          approvals={approvals}
          inputText={inputText}
          selectedThreadId={selectedThreadId}
          selectedRepoId={selectedRepoId}
          selectedRepoPath={selectedRepo?.path ?? null}
          selectedModel={selectedModel}
          availableModels={availableModels}
          permissionMode={permissionMode}
          onInputTextChange={(value) => setInputText(value)}
          onSend={handleSend}
          onStop={handleStop}
          onModelChange={handleModelChange}
          onPermissionModeChange={handlePermissionModeChange}
          onApprove={handleApprove}
        />
      </div>
    </div>
  );
}
