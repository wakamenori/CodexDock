import { HeaderBar } from "./components/HeaderBar";
import { MainPanel } from "./components/MainPanel";
import { Sidebar } from "./components/Sidebar";
import { useConversationState } from "./modules/conversation/ui/useConversationState";

export default function App() {
  const {
    repoGroups,
    selectedRepoId,
    selectedRepo,
    selectedThreadId,
    wsConnected,
    running,
    errorMessage,
    messages,
    diffs,
    fileChanges,
    approvals,
    inputText,
    selectRepo,
    setInputText,
    handleAddRepo,
    handleCreateThread,
    handleSelectThread,
    handleApprove,
    handleSend,
  } = useConversationState();

  return (
    <div className="h-screen flex flex-col gap-4 p-4 overflow-hidden">
      <HeaderBar wsConnected={wsConnected} />
      <div className="flex flex-1 min-h-0 gap-4">
        <Sidebar
          repoGroups={repoGroups}
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
          errorMessage={errorMessage}
          messages={messages}
          diffs={diffs}
          fileChanges={fileChanges}
          approvals={approvals}
          inputText={inputText}
          selectedThreadId={selectedThreadId}
          selectedRepoId={selectedRepoId}
          selectedRepoPath={selectedRepo?.path ?? null}
          onInputTextChange={(value) => setInputText(value)}
          onSend={handleSend}
          onApprove={handleApprove}
        />
      </div>
    </div>
  );
}
