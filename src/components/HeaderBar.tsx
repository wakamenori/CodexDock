type HeaderBarProps = {
  wsConnected: boolean;
};

export function HeaderBar({ wsConnected }: HeaderBarProps) {
  return (
    <header className="flex items-center justify-between rounded-2xl border border-ink-700 bg-ink-800/70 px-6 py-4 shadow-panel">
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-neon-300">
          CodexDock
        </p>
        <h1 className="text-2xl font-semibold text-ink-100">
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
  );
}
