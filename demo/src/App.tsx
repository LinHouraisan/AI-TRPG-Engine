import { useSession } from "@/session";
import { Composer } from "@/ui/Composer";
import { InvestigatorSheet } from "@/ui/InvestigatorSheet";
import { NarrationColumn } from "@/ui/NarrationColumn";
import { RoomMap } from "@/ui/RoomMap";
import { Clues, EventLog, Inventory, StoryFlags } from "@/ui/SidePanels";

export default function App() {
  const session = useSession();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-line/60 px-6 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-base tracking-wide">AI TRPG Engine</span>
          <span className="text-xs text-muted">试玩 · 《寄宿公寓账本》</span>
        </div>
        <span className="rounded border border-line/60 px-2 py-0.5 text-[11px] text-muted">
          状态版本 v{session.state.version} · 事件 {session.log.length} 条
        </span>
        <div className="ml-auto flex gap-2 text-[13px]">
          <button
            type="button"
            onClick={() => {
              const hash = session.save();
              session.pushSystem(`已存档：事件 ${session.log.length} 条，状态哈希 ${hash}。`);
            }}
            className="rounded border border-line/70 px-2.5 py-1 transition hover:border-brass/60 hover:text-brass"
          >
            存档
          </button>
          <button
            type="button"
            onClick={() => {
              const result = session.load();
              session.pushSystem(result.reason);
            }}
            className="rounded border border-line/70 px-2.5 py-1 transition hover:border-brass/60 hover:text-brass"
          >
            读档
          </button>
          <button
            type="button"
            onClick={session.reset}
            className="rounded border border-line/70 px-2.5 py-1 text-muted transition hover:border-blood/60 hover:text-blood"
          >
            重开
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_280px] gap-3 p-3">
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <InvestigatorSheet state={session.state} />
          <RoomMap state={session.state} />
        </aside>

        <main className="flex min-h-0 flex-col rounded-lg border border-line/60 bg-ink-2/40">
          <NarrationColumn messages={session.messages} />
          <Composer
            suggestions={session.suggestions}
            busy={session.busy}
            onSuggestion={(suggestion) => session.act(suggestion.intent, suggestion.label)}
            onSay={session.say}
          />
        </main>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Inventory state={session.state} />
          <Clues state={session.state} />
          <StoryFlags state={session.state} />
          <EventLog log={session.log} />
        </aside>
      </div>
    </div>
  );
}
