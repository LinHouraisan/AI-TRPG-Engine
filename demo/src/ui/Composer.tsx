import { useEffect, useRef, useState } from "react";
import type { Suggestion } from "@/engine/types";

export function Composer({
  suggestions,
  busy,
  canRetell,
  onSuggestion,
  onSay,
  onRetell,
}: {
  suggestions: Suggestion[];
  busy: boolean;
  canRetell: boolean;
  onSuggestion: (suggestion: Suggestion) => void;
  onSay: (text: string) => void;
  onRetell: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [lastSpoken, setLastSpoken] = useState("");
  // busy 是下一帧才变的；连点会在那之前钻进去，两段草稿就会打架。
  const held = useRef(false);

  useEffect(() => {
    if (!busy) held.current = false;
  }, [busy]);

  function submit() {
    const text = draft.trim();
    if (!text || busy || held.current) return;
    held.current = true;
    setLastSpoken(text);
    setDraft("");
    onSay(text);
  }

  function pick(suggestion: Suggestion) {
    if (busy || held.current) return;
    held.current = true;
    setLastSpoken(suggestion.label);
    onSuggestion(suggestion);
  }

  function retell() {
    if (busy || held.current || !canRetell) return;
    held.current = true;
    onRetell();
  }

  return (
    <div className="border-t border-line/60 bg-ink-2/60 px-3 py-3 md:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              disabled={busy}
              onClick={() => pick(suggestion)}
              className="min-h-11 rounded-full border border-line/70 bg-ink-3/60 px-3 text-[13px] text-paper/90 transition hover:border-brass/60 hover:text-brass disabled:opacity-50"
            >
              {suggestion.label}
            </button>
          ))}
          {canRetell ? (
            <button
              type="button"
              disabled={busy}
              onClick={retell}
              title="同一批已提交事件重讲一遍：不重掷骰子，状态版本也不变"
              className="ml-auto min-h-11 rounded-full border border-dashed border-line/70 px-3 text-[13px] text-muted transition hover:border-brass/60 hover:text-brass disabled:opacity-50"
            >
              换一种说法
            </button>
          ) : null}
        </div>
        <div className="flex items-end gap-2 rounded-lg border border-line/70 bg-ink-3/40 p-2 focus-within:border-brass/60">
          <textarea
            value={draft}
            rows={2}
            placeholder="你打算做什么？直接说就行，建议行动只是省事，不是能做的全部。"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && !event.altKey && !event.metaKey) {
                const box = event.currentTarget;
                const atStart = box.selectionStart === 0 && box.selectionEnd === 0;
                if (lastSpoken && (draft.length === 0 || atStart)) {
                  event.preventDefault();
                  setDraft(lastSpoken);
                }
                return;
              }
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
            className="min-h-11 min-w-11 rounded-md bg-brass px-3 text-sm font-medium text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            行动
          </button>
        </div>
      </div>
    </div>
  );
}
