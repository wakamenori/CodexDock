import { useState } from "react";

import { formatRelativeTime } from "../shared/date";
import type {
  Repo,
  SessionStatus,
  ThreadSummary,
  ThreadUiStatus,
} from "../types";

type RepoGroup = {
  repo: Repo;
  threads: ThreadSummary[];
  sessionStatus: SessionStatus;
};

type SidebarProps = {
  repoGroups: RepoGroup[];
  threadUiStatusByThread: Record<string, ThreadUiStatus>;
  selectedRepoId: string | null;
  running: boolean;
  selectedThreadId: string | null;
  onSelectRepo: (repoId: string | null) => void;
  onAddRepo: () => void;
  onCreateThread: (repoId: string) => void;
  onSelectThread: (repoId: string, threadId: string) => void;
};

export function Sidebar({
  repoGroups,
  threadUiStatusByThread,
  selectedRepoId,
  running,
  selectedThreadId,
  onSelectRepo,
  onAddRepo,
  onCreateThread,
  onSelectThread,
}: SidebarProps) {
  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>(
    {},
  );

  const statusDot = (status: ThreadUiStatus) => {
    switch (status) {
      case "approval":
        return "bg-rose-400 shadow-[0_0_0_4px_rgba(251,113,133,0.25)]";
      case "reviewing":
        return "bg-teal-400 shadow-[0_0_0_4px_rgba(45,212,191,0.2)]";
      case "processing":
        return "bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.2)]";
      case "unread":
        return "bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.22)]";
      default:
        return "bg-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]";
    }
  };

  const statusPulse = (status: ThreadUiStatus) =>
    status === "approval" || status === "processing" || status === "reviewing"
      ? "animate-pulseSoft"
      : "";

  const getThreadTime = (value?: string) => formatRelativeTime(value);
  const getThreadTimestamp = (thread: ThreadSummary) => {
    const value = thread.createdAt ?? thread.updatedAt;
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  const toggleRepo = (repoId: string) => {
    setExpandedRepos((prev) => ({ ...prev, [repoId]: !prev[repoId] }));
  };

  const sortThreads = (threads: ThreadSummary[]) =>
    [...threads].sort((a, b) => {
      const timeA = getThreadTimestamp(a);
      const timeB = getThreadTimestamp(b);
      if (timeA !== timeB) return timeB - timeA;
      return a.threadId.localeCompare(b.threadId);
    });

  const maxThreads = 5;

  return (
    <aside className="w-72 shrink-0 rounded-2xl border border-ink-700 bg-ink-800/70 p-4 shadow-panel flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.3em] text-ink-300">
          Repositories
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-thin">
        <div className="flex flex-col gap-3">
          {repoGroups.map(({ repo, threads }) => {
            const isSelected = selectedRepoId === repo.repoId;
            const orderedThreads = sortThreads(threads);
            const expanded = expandedRepos[repo.repoId] ?? false;
            const visibleThreads = expanded
              ? orderedThreads
              : orderedThreads.slice(0, maxThreads);
            const hasOverflow = orderedThreads.length > maxThreads;
            return (
              <div
                key={repo.repoId}
                className={`rounded-xl border px-3 py-3 ${
                  isSelected
                    ? "border-neon-400/60 bg-ink-800/80 shadow-[0_0_0_1px_rgba(122,162,247,0.25)]"
                    : "border-ink-700/60 bg-ink-900/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    className="flex-1 truncate text-left text-sm font-semibold text-ink-100 hover:text-ink-50"
                    onClick={() => onSelectRepo(repo.repoId)}
                    disabled={running}
                    type="button"
                    title={repo.name}
                  >
                    {repo.name}
                  </button>
                  <button
                    className="rounded-full border border-ink-600 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-ink-300 transition hover:border-neon-400 hover:text-ink-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateThread(repo.repoId);
                    }}
                    disabled={running}
                    type="button"
                  >
                    New
                  </button>
                </div>

                <div className="mt-2 flex flex-col gap-1">
                  {visibleThreads.map((thread) => {
                    const preview = thread.preview?.trim();
                    const label = preview || "New thread";
                    const timeLabel = getThreadTime(
                      thread.createdAt ?? thread.updatedAt,
                    );
                    const isThreadSelected =
                      isSelected && selectedThreadId === thread.threadId;
                    const threadStatus =
                      threadUiStatusByThread[thread.threadId] ?? "ready";
                    return (
                      <button
                        key={thread.threadId}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition ${
                          isThreadSelected
                            ? "bg-ink-700/70 text-ink-100"
                            : "text-ink-200 hover:bg-ink-800/60"
                        }`}
                        onClick={() =>
                          onSelectThread(repo.repoId, thread.threadId)
                        }
                        type="button"
                        title={label}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${statusDot(threadStatus)} ${statusPulse(threadStatus)}`}
                        />
                        <span className="flex-1 truncate">{label}</span>
                        {timeLabel && (
                          <span className="text-[10px] text-ink-400 tabular-nums">
                            {timeLabel}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {!visibleThreads.length && (
                    <p className="px-2 text-[11px] text-ink-400">
                      No threads yet.
                    </p>
                  )}
                </div>

                {hasOverflow && (
                  <button
                    className="mt-2 px-2 text-[11px] text-ink-400 hover:text-ink-200"
                    onClick={() => toggleRepo(repo.repoId)}
                    type="button"
                  >
                    {expanded ? "Less..." : "More..."}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button
        className="w-full rounded-md border border-ink-600 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-ink-300 transition hover:border-ink-400 hover:text-ink-200"
        onClick={onAddRepo}
        type="button"
      >
        Add Repo
      </button>
    </aside>
  );
}
