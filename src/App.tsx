import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import type {
  ApprovalRequest,
  ChatMessage,
  DiffEntry,
  JsonValue,
  Repo,
  SessionStatus,
  ThreadSummary,
  WsInboundMessage,
  WsOutboundMessage,
} from "./types";

const createRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const getIdString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
};

const extractTurnId = (params: unknown) => {
  const record = asRecord(params);
  const turnRecord = asRecord(record?.turn);
  return (
    getIdString(turnRecord?.id) ??
    getIdString(record?.turnId) ??
    getIdString(record?.id) ??
    getIdString(turnRecord?.turnId)
  );
};

const extractDeltaText = (params: unknown) => {
  const record = asRecord(params);
  const directDelta = record?.delta;
  if (typeof directDelta === "string") return directDelta;
  const deltaRecord = asRecord(record?.delta);
  const candidate =
    deltaRecord?.text ??
    deltaRecord?.content ??
    record?.text ??
    record?.message;
  return typeof candidate === "string" ? candidate : "";
};

const extractDiffText = (params: unknown) => {
  const record = asRecord(params);
  const diffRecord = asRecord(record?.diff);
  const candidate =
    diffRecord?.text ?? diffRecord?.patch ?? record?.diff ?? record?.patch;
  if (typeof candidate === "string") {
    return candidate;
  }
  return JSON.stringify(params ?? {}, null, 2);
};

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [threadsByRepo, setThreadsByRepo] = useState<
    Record<string, ThreadSummary[]>
  >({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [sessionStatusByRepo, setSessionStatusByRepo] = useState<
    Record<string, SessionStatus>
  >({});
  const [messagesByRepo, setMessagesByRepo] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [diffsByRepo, setDiffsByRepo] = useState<Record<string, DiffEntry[]>>(
    {},
  );
  const [pendingApprovals, setPendingApprovals] = useState<
    Record<string, ApprovalRequest[]>
  >({});
  const [activeTurnByRepo, setActiveTurnByRepo] = useState<
    Record<string, string | null>
  >({});
  const [inputText, setInputText] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPath, setNewRepoPath] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRepoRef = useRef<string | null>(null);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.repoId === selectedRepoId) ?? null,
    [repos, selectedRepoId],
  );
  const lastOpenedThreadId = selectedRepo?.lastOpenedThreadId ?? null;

  const threads = selectedRepoId ? (threadsByRepo[selectedRepoId] ?? []) : [];
  const messages = selectedRepoId ? (messagesByRepo[selectedRepoId] ?? []) : [];
  const diffs = selectedRepoId ? (diffsByRepo[selectedRepoId] ?? []) : [];
  const approvals = selectedRepoId
    ? (pendingApprovals[selectedRepoId] ?? [])
    : [];
  const sessionStatus = selectedRepoId
    ? (sessionStatusByRepo[selectedRepoId] ?? "stopped")
    : "stopped";
  const running = selectedRepoId
    ? Boolean(activeTurnByRepo[selectedRepoId])
    : false;

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.listRepos();
        setRepos(data);
        if (data.length > 0) {
          setSelectedRepoId((current) => current ?? data[0].repoId);
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load repos",
        );
      }
    })();
  }, []);

  useEffect(() => {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    wsRef.current = ws;

    ws.addEventListener("open", () => setWsConnected(true));
    ws.addEventListener("close", () => setWsConnected(false));
    ws.addEventListener("error", () => setWsConnected(false));
    ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data) as WsInboundMessage;
        handleWsMessage(message);
      } catch (error) {
        console.warn("WS message parse error", error);
      }
    });

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (!wsConnected || !selectedRepoId || !wsRef.current) return;
    const previousRepoId = subscribedRepoRef.current;
    if (previousRepoId && previousRepoId !== selectedRepoId) {
      sendWs({
        type: "unsubscribe",
        requestId: createRequestId(),
        payload: { repoId: previousRepoId },
      });
    }
    subscribedRepoRef.current = selectedRepoId;
    sendWs({
      type: "subscribe",
      requestId: createRequestId(),
      payload: { repoId: selectedRepoId },
    });
  }, [wsConnected, selectedRepoId]);

  useEffect(() => {
    if (!selectedRepoId) return;
    void (async () => {
      try {
        await api.startSession(selectedRepoId);
        const list = await api.listThreads(selectedRepoId);
        setThreadsByRepo((prev) => ({ ...prev, [selectedRepoId]: list }));
        const preferred = lastOpenedThreadId ?? list[0]?.threadId ?? null;
        setSelectedThreadId(preferred);
        if (preferred) {
          await api.resumeThread(selectedRepoId, preferred);
          await api.updateRepo(selectedRepoId, {
            lastOpenedThreadId: preferred,
          });
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to start session",
        );
      }
    })();
  }, [lastOpenedThreadId, selectedRepoId]);

  const sendWs = (message: WsOutboundMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const handleWsMessage = (message: WsInboundMessage) => {
    switch (message.type) {
      case "subscribe_error":
        setErrorMessage(message.payload.error.message);
        break;
      case "session_status":
        setSessionStatusByRepo((prev) => ({
          ...prev,
          [message.payload.repoId]: message.payload.status,
        }));
        break;
      case "thread_list_updated":
        setThreadsByRepo((prev) => ({
          ...prev,
          [message.payload.repoId]: message.payload.threads,
        }));
        break;
      case "app_server_notification":
        handleAppServerNotification(
          message.payload.repoId,
          message.payload.message,
        );
        break;
      case "app_server_request":
        handleAppServerRequest(message.payload.repoId, message.payload.message);
        break;
      default:
        break;
    }
  };

  const handleAppServerNotification = (
    repoId: string,
    message: { method: string; params?: JsonValue },
  ) => {
    const { method, params } = message;
    if (method.includes("Message") && method.includes("delta")) {
      const paramsRecord = asRecord(params);
      const itemRecord = asRecord(paramsRecord?.item);
      const itemId =
        getIdString(itemRecord?.id) ??
        getIdString(paramsRecord?.itemId) ??
        `${method}-${Date.now()}`;
      const deltaText = extractDeltaText(params);
      if (!deltaText) return;
      setMessagesByRepo((prev) => {
        const list = [...(prev[repoId] ?? [])];
        const idx = list.findIndex((item) => item.id === itemId);
        if (idx >= 0) {
          list[idx] = { ...list[idx], text: list[idx].text + deltaText };
        } else {
          list.push({
            id: itemId,
            role: "agent",
            text: deltaText,
            createdAt: Date.now(),
          });
        }
        return { ...prev, [repoId]: list };
      });
    }

    if (method === "turn/diff/updated") {
      const turnId = extractTurnId(params) ?? `${Date.now()}`;
      const diffText = extractDiffText(params);
      setDiffsByRepo((prev) => {
        const list = [...(prev[repoId] ?? [])];
        const idx = list.findIndex((entry) => entry.turnId === turnId);
        if (idx >= 0) {
          list[idx] = { ...list[idx], diffText, updatedAt: Date.now() };
        } else {
          list.push({ turnId, diffText, updatedAt: Date.now() });
        }
        return { ...prev, [repoId]: list };
      });
    }

    if (method === "turn/started") {
      const turnId = extractTurnId(params) ?? null;
      if (turnId) {
        setActiveTurnByRepo((prev) => ({ ...prev, [repoId]: String(turnId) }));
      }
    }

    if (method === "turn/completed" || method === "turn/failed") {
      setActiveTurnByRepo((prev) => ({ ...prev, [repoId]: null }));
    }
  };

  const handleAppServerRequest = (
    repoId: string,
    message: { id: number | string; method: string; params?: JsonValue },
  ) => {
    const paramsRecord = asRecord(message.params);
    const entry: ApprovalRequest = {
      rpcId: message.id,
      method: message.method,
      params: message.params,
      receivedAt: Date.now(),
      threadId: paramsRecord ? getIdString(paramsRecord.threadId) : undefined,
      turnId: paramsRecord ? getIdString(paramsRecord.turnId) : undefined,
      itemId: paramsRecord ? getIdString(paramsRecord.itemId) : undefined,
    };
    setPendingApprovals((prev) => {
      const list = [...(prev[repoId] ?? []), entry];
      return { ...prev, [repoId]: list };
    });
  };

  const handleApprove = (
    repoId: string,
    request: ApprovalRequest,
    decision: "accept" | "decline",
  ) => {
    sendWs({
      type: "app_server_response",
      payload: {
        repoId,
        message: {
          id: request.rpcId,
          result: { decision },
        },
      },
    });
    setPendingApprovals((prev) => {
      const list = (prev[repoId] ?? []).filter(
        (item) => item.rpcId !== request.rpcId,
      );
      return { ...prev, [repoId]: list };
    });
  };

  const handleSend = async () => {
    if (!selectedRepoId || !selectedThreadId || !inputText.trim()) return;
    try {
      const turn = await api.startTurn(selectedRepoId, selectedThreadId, [
        { type: "text", text: inputText.trim() },
      ]);
      setActiveTurnByRepo((prev) => ({
        ...prev,
        [selectedRepoId]: turn.turnId,
      }));
      setInputText("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Turn failed");
    }
  };

  const handleCreateThread = async () => {
    if (!selectedRepoId) return;
    try {
      const threadId = await api.createThread(selectedRepoId);
      await api.resumeThread(selectedRepoId, threadId);
      setSelectedThreadId(threadId);
      await api.updateRepo(selectedRepoId, { lastOpenedThreadId: threadId });
      const list = await api.listThreads(selectedRepoId);
      setThreadsByRepo((prev) => ({ ...prev, [selectedRepoId]: list }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create thread",
      );
    }
  };

  const handleSelectThread = async (threadId: string) => {
    if (!selectedRepoId) return;
    setSelectedThreadId(threadId);
    try {
      await api.resumeThread(selectedRepoId, threadId);
      await api.updateRepo(selectedRepoId, { lastOpenedThreadId: threadId });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to resume thread",
      );
    }
  };

  const handleAddRepo = async () => {
    if (!newRepoName.trim() || !newRepoPath.trim()) return;
    try {
      const repo = await api.createRepo(newRepoName.trim(), newRepoPath.trim());
      setRepos((prev) => [...prev, repo]);
      setSelectedRepoId(repo.repoId);
      setNewRepoName("");
      setNewRepoPath("");
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : "Failed to add repo",
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between rounded-2xl border border-ink-700 bg-ink-800/70 px-6 py-4 shadow-panel">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-neon-300">
            CodexDock
          </p>
          <h1 className="text-2xl font-semibold text-white">
            Local Web Assistant Console
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-300">WebSocket</p>
          <p
            className={`text-sm font-medium ${wsConnected ? "text-neon-500" : "text-ink-300"}`}
          >
            {wsConnected ? "connected" : "disconnected"}
          </p>
        </div>
      </header>

      <div className="flex flex-1 gap-4">
        <aside className="w-80 shrink-0 rounded-2xl border border-ink-700 bg-ink-800/70 p-4 shadow-panel flex flex-col gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
              Repository
            </p>
            <select
              className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 text-sm"
              value={selectedRepoId ?? ""}
              onChange={(event) =>
                setSelectedRepoId(event.target.value || null)
              }
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
              onChange={(event) => setNewRepoName(event.target.value)}
            />
            <input
              className="mt-2 w-full rounded-md border border-ink-600 bg-ink-900/70 px-3 py-2 text-sm font-mono"
              placeholder="/abs/path/to/repo"
              value={newRepoPath}
              onChange={(event) => setNewRepoPath(event.target.value)}
            />
            <button
              className="mt-3 w-full rounded-md bg-neon-500/90 px-3 py-2 text-sm font-semibold text-ink-900 transition hover:bg-neon-500"
              onClick={handleAddRepo}
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
                onClick={handleCreateThread}
                disabled={!selectedRepoId || running}
                type="button"
              >
                New
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {threads.map((thread) => (
                <button
                  key={thread.threadId}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                    selectedThreadId === thread.threadId
                      ? "border-neon-400 bg-ink-700/70"
                      : "border-ink-700 bg-ink-900/60 hover:border-ink-500"
                  }`}
                  onClick={() => handleSelectThread(thread.threadId)}
                  disabled={running}
                  type="button"
                >
                  <p className="font-semibold text-white">{thread.threadId}</p>
                  {thread.preview && (
                    <p className="mt-1 text-ink-300">{thread.preview}</p>
                  )}
                  {thread.updatedAt && (
                    <p className="mt-1 text-[10px] text-ink-300">
                      {formatTime(thread.updatedAt)}
                    </p>
                  )}
                </button>
              ))}
              {!threads.length && (
                <p className="text-xs text-ink-300">No threads yet.</p>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 rounded-2xl border border-ink-700 bg-ink-900/60 shadow-panel flex flex-col">
          <div className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
                Active Repo
              </p>
              <p className="text-lg font-semibold text-white">
                {selectedRepo?.name ?? "Select a repo"}
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

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 scrollbar-thin">
            {errorMessage && (
              <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {errorMessage}
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className="rounded-xl border border-ink-700 bg-ink-800/70 px-4 py-3"
              >
                <p className="text-xs text-ink-300">assistant</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white">
                  {message.text}
                </p>
              </div>
            ))}

            {diffs.map((diff) => (
              <div
                key={diff.turnId}
                className="rounded-xl border border-neon-500/30 bg-ink-900/80 px-4 py-3"
              >
                <p className="text-xs text-neon-300">diff · {diff.turnId}</p>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-ink-900/70 p-3 text-xs text-neon-300">
                  {diff.diffText}
                </pre>
              </div>
            ))}

            {!messages.length && !diffs.length && (
              <div className="rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-300">
                Start a turn to see the stream here.
              </div>
            )}
          </div>

          {approvals.length > 0 && selectedRepoId && (
            <div className="border-t border-ink-700 bg-ink-800/60 px-6 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-ink-300">
                Approval
              </p>
              <div className="mt-3 grid gap-3">
                {approvals.map((approval) => (
                  <div
                    key={String(approval.rpcId)}
                    className="rounded-xl border border-ink-700 bg-ink-900/70 px-4 py-3"
                  >
                    <p className="text-sm font-semibold text-white">
                      {approval.method}
                    </p>
                    <p className="mt-1 text-xs text-ink-300">
                      item: {approval.itemId ?? "-"}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-md bg-neon-500/90 px-3 py-2 text-xs font-semibold text-ink-900"
                        onClick={() =>
                          handleApprove(selectedRepoId, approval, "accept")
                        }
                        type="button"
                      >
                        Apply
                      </button>
                      <button
                        className="rounded-md border border-ink-600 px-3 py-2 text-xs text-ink-200 hover:border-red-400"
                        onClick={() =>
                          handleApprove(selectedRepoId, approval, "decline")
                        }
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-ink-700 px-6 py-4">
            <div className="rounded-xl border border-ink-700 bg-ink-800/70 px-4 py-3">
              <textarea
                className="h-28 w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-ink-300"
                placeholder={
                  selectedThreadId
                    ? "Describe what you want to build..."
                    : "Select or create a thread"
                }
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={!selectedThreadId || running}
              />
              <div className="mt-2 flex items-center justify-between text-xs text-ink-300">
                <span>
                  {running ? "Streaming..." : "Shift+Enter for newline"}
                </span>
                <button
                  className="rounded-md bg-neon-500/90 px-4 py-2 text-xs font-semibold text-ink-900 disabled:opacity-50"
                  onClick={handleSend}
                  disabled={!selectedThreadId || running || !inputText.trim()}
                  type="button"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
