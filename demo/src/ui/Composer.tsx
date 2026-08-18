import { useState } from "react";
import type { Suggestion } from "@/engine/types";

export function Composer({
  suggestions,
  busy,
  onSuggestion,
  onSay,
}: {
  suggestions: Suggestion[];
  busy: boolean;
  onSuggestion: (suggestion: Suggestion) => void;
  onSay: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSay(text);
  }

  return (
    <div className="border-t border-line/60 bg-ink-2/60 px-6 py-3">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              disabled={busy}
              onClick={() => onSuggestion(suggestion)}
              className="rounded-full border border-line/70 bg-ink-3/60 px-3 py-1 text-[13px] text-paper/90 transition hover:border-brass/60 hover:text-brass disabled:opacity-50"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-lg border border-line/70 bg-ink-3/40 p-2 focus-within:border-brass/60">
          <textarea
            value={draft}
            rows={2}
            placeholder="你打算做什么？直接说就行，建议行动只是省事，不是能做的全部。"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="min-h-11 flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted/70"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || draft.trim().length === 0}
            className="rounded-md bg-brass px-3 py-1.5 text-sm font-medium text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            行动
          </button>
        </div>
      </div>
    </div>
  );
}
