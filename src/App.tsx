import { HeaderBar } from "./components/HeaderBar";
import { MainPanel } from "./components/MainPanel";
import { Sidebar } from "./components/Sidebar";
import { useConversationState } from "./modules/conversation/ui/useConversationState";

export default function App() {
  const {
    repos,
    selectedRepoId,
    selectedRepo,
    newRepoName,
    newRepoPath,
    sessionStatus,
    visibleThreads,
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
    setNewRepoName,
    setNewRepoPath,
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
          repos={repos}
          selectedRepoId={selectedRepoId}
          selectedRepo={selectedRepo}
          newRepoName={newRepoName}
          newRepoPath={newRepoPath}
          sessionStatus={sessionStatus}
          running={running}
          visibleThreads={visibleThreads}
          selectedThreadId={selectedThreadId}
          onRepoChange={selectRepo}
          onNewRepoNameChange={(value) => setNewRepoName(value)}
          onNewRepoPathChange={(value) => setNewRepoPath(value)}
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
