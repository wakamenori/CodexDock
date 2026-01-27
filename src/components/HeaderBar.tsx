import { useConversationSelector } from "../modules/conversation/provider/useConversationSelector";
import { selectWsConnected } from "../modules/conversation/store/selectors";

export function HeaderBar() {
  const wsConnected = useConversationSelector(selectWsConnected);
  return (
    <header className="flex items-center justify-between rounded-2xl border border-ink-700 bg-ink-800/70 px-6 pb-3 pt-3 shadow-panel">
      <h1 className="flex flex-wrap items-baseline gap-3 text-ink-100">
        <span className="text-xs uppercase tracking-[0.3em] text-neon-300">
          CodexDock
        </span>
        <span className="text-lg font-semibold">
          Local Web Assistant Console
        </span>
      </h1>
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
