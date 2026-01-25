type ComposerProps = {
  inputText: string;
  selectedThreadId: string | null;
  running: boolean;
  onInputTextChange: (value: string) => void;
  onSend: () => void | Promise<void>;
};

export function Composer({
  inputText,
  selectedThreadId,
  running,
  onInputTextChange,
  onSend,
}: ComposerProps) {
  return (
    <div className="border-t border-ink-700 px-6 py-4">
      <div className="rounded-xl border border-ink-700 bg-ink-800/70 px-4 py-3">
        <textarea
          className="h-28 w-full resize-none bg-transparent text-sm text-ink-200 outline-none placeholder:text-ink-300"
          placeholder={
            selectedThreadId
              ? "Describe what you want to build..."
              : "Select or create a thread"
          }
          value={inputText}
          onChange={(event) => onInputTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (running || !selectedThreadId || !inputText.trim()) return;
              void onSend();
            }
          }}
          disabled={!selectedThreadId}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-ink-300">
          <span>{running ? "Streaming..." : "Shift+Enter for newline"}</span>
          <button
            className="rounded-md bg-neon-500/90 px-4 py-2 text-xs font-semibold text-ink-900 disabled:opacity-50"
            onClick={onSend}
            disabled={!selectedThreadId || running || !inputText.trim()}
            type="button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
