import type { Repo, SessionStatus, ThreadSummary } from "../types";
import { formatTime } from "../utils/appUtils";

type SidebarProps = {
  repos: Repo[];
  selectedRepoId: string | null;
  selectedRepo: Repo | null;
  newRepoName: string;
  newRepoPath: string;
  sessionStatus: SessionStatus;
  running: boolean;
  visibleThreads: ThreadSummary[];
  selectedThreadId: string | null;
  onRepoChange: (repoId: string | null) => void;
  onNewRepoNameChange: (value: string) => void;
  onNewRepoPathChange: (value: string) => void;
  onAddRepo: () => void;
  onCreateThread: () => void;
  onSelectThread: (threadId: string) => void;
};

export function Sidebar({
  repos,
  selectedRepoId,
  selectedRepo,
  newRepoName,
  newRepoPath,
  sessionStatus,
  running,
  visibleThreads,
  selectedThreadId,
  onRepoChange,
  onNewRepoNameChange,
  onNewRepoPathChange,
  onAddRepo,
  onCreateThread,
  onSelectThread,
}: SidebarProps) {
  return (
    <aside className="w-80 shrink-0 rounded-2xl border border-ink-700 bg-ink-800/70 p-4 shadow-panel flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
          Repository
        </p>
        <select
          className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 text-sm"
          value={selectedRepoId ?? ""}
          onChange={(event) => onRepoChange(event.target.value || null)}
          disabled={running}
        >
          <option value="" disabled>
            Select repo
          </option>
          {repos.map((repo) => (
            <option key={repo.repoId} value={repo.repoId}>
              {repo.name}
            </option>
          ))}
        </select>
        {selectedRepo && (
          <p className="mt-2 text-xs text-ink-300 break-all">
            {selectedRepo.path}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-ink-700/70 bg-ink-900/50 p-3">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
          Add Repo
        </p>
        <input
          className="mt-2 w-full rounded-md border border-ink-600 bg-ink-900/70 px-3 py-2 text-sm"
          placeholder="Display name"
          value={newRepoName}
          onChange={(event) => onNewRepoNameChange(event.target.value)}
        />
        <input
          className="mt-2 w-full rounded-md border border-ink-600 bg-ink-900/70 px-3 py-2 text-sm font-mono"
          placeholder="/abs/path/to/repo"
          value={newRepoPath}
          onChange={(event) => onNewRepoPathChange(event.target.value)}
        />
        <button
          className="mt-3 w-full rounded-md bg-neon-500/90 px-3 py-2 text-sm font-semibold text-ink-900 transition hover:bg-neon-500"
          onClick={onAddRepo}
          type="button"
        >
          Register
        </button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="uppercase tracking-[0.2em] text-ink-300">
          Session
        </span>
        <span
          className={`rounded-full px-2 py-1 text-xs font-semibold ${
            sessionStatus === "connected"
              ? "bg-neon-500/20 text-neon-500"
              : sessionStatus === "starting"
                ? "bg-neon-300/20 text-neon-300"
                : sessionStatus === "error"
                  ? "bg-red-500/20 text-red-300"
                  : "bg-ink-700/60 text-ink-300"
          }`}
        >
          {sessionStatus}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
            Threads
          </p>
          <button
            className="rounded-md border border-ink-600 px-2 py-1 text-xs hover:border-neon-300"
            onClick={onCreateThread}
            disabled={!selectedRepoId || running}
            type="button"
          >
            New
          </button>
        </div>
        <div className="mt-3 flex max-h-[40vh] flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin">
          {visibleThreads.map((thread) => (
            <button
              key={thread.threadId}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                selectedThreadId === thread.threadId
                  ? "border-neon-400 bg-ink-700/70"
                  : "border-ink-700 bg-ink-900/60 hover:border-ink-500"
              }`}
              onClick={() => onSelectThread(thread.threadId)}
              disabled={running}
              type="button"
            >
              <p
                className="font-semibold text-ink-100 truncate"
                title={thread.threadId}
              >
                {thread.threadId}
              </p>
              {thread.preview && (
                <p className="mt-1 truncate text-ink-300" title={thread.preview}>
                  {thread.preview}
                </p>
              )}
              {thread.updatedAt && (
                <p className="mt-1 text-[10px] text-ink-300">
                  {formatTime(thread.updatedAt)}
                </p>
              )}
            </button>
          ))}
          {!visibleThreads.length && (
            <p className="text-xs text-ink-300">No threads yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
