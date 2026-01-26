type ComposerProps = {
  inputText: string;
  selectedThreadId: string | null;
  running: boolean;
  selectedModel: string | null;
  availableModels: string[] | undefined;
  onInputTextChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onModelChange: (model: string | null) => void;
};

export function Composer({
  inputText,
  selectedThreadId,
  running,
  selectedModel,
  availableModels,
  onInputTextChange,
  onSend,
  onModelChange,
}: ComposerProps) {
  const normalizedModel = selectedModel ?? "";
  const modelOptions = availableModels ?? [];
  const displayModels = normalizedModel
    ? Array.from(new Set([normalizedModel, ...modelOptions]))
    : modelOptions;

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
            const isComposing =
              event.nativeEvent.isComposing || event.key === "Process";
            if (event.key !== "Enter" || !event.ctrlKey || isComposing) return;
            event.preventDefault();
            if (running || !selectedThreadId || !inputText.trim()) return;
            void onSend();
          }}
          disabled={!selectedThreadId}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300">
          <span>
            {running
              ? "Streaming..."
              : "Enter for newline · Ctrl+Enter to send"}
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span>Model</span>
              <select
                className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                value={normalizedModel}
                onChange={(event) => onModelChange(event.target.value || null)}
                disabled={!selectedThreadId}
              >
                <option value="" disabled>
                  Unset
                </option>
                {displayModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
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
    </div>
  );
}
