import { useRef, useState } from "react";
import type { GameEvent, GameState, Suggestion } from "@/engine/types";
import { useSession } from "@/session";
import { CampaignDock } from "@/ui/CampaignDock";
import { CardImport } from "@/ui/CardImport";
import { Composer } from "@/ui/Composer";
import { ContextUsagePanel } from "@/ui/ContextUsage";
import { JobTracePanel } from "@/ui/JobTrace";
import { InvestigatorSheet } from "@/ui/InvestigatorSheet";
import { KeeperSettings } from "@/ui/KeeperSettings";
import { ModelSettings } from "@/ui/ModelSettings";
import { FirstRunFlow } from "@/ui/FirstRunFlow";
import { EndingSummary } from "@/ui/EndingSummary";
import { NarrationColumn } from "@/ui/NarrationColumn";
import { PackSelector } from "@/ui/PackSelector";
import { composeWait } from "@/ui/pending";
import { RoomMap } from "@/ui/RoomMap";
import { Clues, EventLog, Inventory, StoryFlags } from "@/ui/SidePanels";
import { Timeline, type TurnMark } from "@/ui/Timeline";
import { desktopApi } from "@/desktop";

type MobilePane = "narration" | "sheet" | "scene" | "record";

const PANES: { id: MobilePane; label: string }[] = [
  { id: "narration", label: "叙述" },
  { id: "sheet", label: "调查员" },
  { id: "scene", label: "场景" },
  { id: "record", label: "记录" },
];

export default function App() {
  const session = useSession();
  const desktop = Boolean(desktopApi());
  const filePicker = useRef<HTMLInputElement>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("narration");

  const wait = composeWait({
    busy: session.busy,
    status: session.status,
    pending: session.pending,
  });

  function actFromSuggestion(suggestion: Suggestion) {
    void session.act(suggestion.intent, suggestion.label);
  }

  function sayText(text: string) {
    void session.say(text);
  }

  function rewindTo(mark: TurnMark) {
    void session.rewind(mark);
  }

  function switchTo(branchId: string) {
    void session.switchBranch(branchId);
  }

  return (
    <div className="flex h-full max-w-full flex-col overflow-x-hidden">
      <header className="flex h-12 shrink-0 flex-nowrap items-center gap-2 border-b border-line/60 px-3 md:h-auto md:gap-4 md:px-6 md:py-2.5">
        <div className="min-w-0 flex-1">
          <CampaignDock />
          <PackSelector
            campaignVersion={session.state.version}
            campaignEvents={session.log.length}
            busy={session.busy}
          />
        </div>

        <SessionChip
          version={session.state.version}
          events={session.log.length}
          backend={session.storeBackend}
          durable={session.storeDurable}
          note={session.storeNote}
        />

        <div className="flex shrink-0 items-center gap-1.5 text-[13px] md:gap-2">
          <CardImport onConfirm={(draft) => void session.confirmCard(draft)} />
          <ModelSettings />
          {!desktop ? <KeeperSettings config={session.config} onChange={session.setConfig} /> : null}
          <button
            type="button"
            onClick={() => void session.exportCampaign()}
            className="min-h-11 shrink-0 rounded border border-line/70 px-2.5 transition hover:border-brass/60 hover:text-brass md:min-h-0 md:px-2.5 md:py-1"
          >
            导出
          </button>
          <button
            type="button"
            onClick={() => filePicker.current?.click()}
            className="min-h-11 shrink-0 rounded border border-line/70 px-2.5 transition hover:border-brass/60 hover:text-brass md:min-h-0 md:px-2.5 md:py-1"
          >
            导入
          </button>
          <input
            ref={filePicker}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void session.importCampaign(file);
            }}
          />
          <button
            type="button"
            onClick={() => void session.reset()}
            className="min-h-11 shrink-0 rounded border border-line/70 px-2.5 text-muted transition hover:border-blood/60 hover:text-blood md:min-h-0 md:px-2.5 md:py-1"
          >
            重开
          </button>
        </div>
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-x-hidden p-3 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,300px)]">
        <aside className="hidden min-h-0 min-w-0 flex-col gap-3 overflow-y-auto md:flex">
          <InvestigatorSheet state={session.state} />
          <RoomMap state={session.state} />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col rounded-lg border border-line/60 bg-ink-2/40">
          <FirstRunFlow version={session.state.version} />
          <EndingSummary state={session.state} />
          <div
            className={`min-h-0 flex-1 flex-col overflow-hidden ${
              mobilePane === "narration" ? "flex" : "hidden"
            } md:flex`}
          >
            <NarrationColumn
              messages={session.messages}
              wait={wait}
              draft={session.narrationDraft}
            />
          </div>
          <div
            className={`min-h-0 flex-1 overflow-y-auto p-3 md:hidden ${
              mobilePane === "sheet" ? "block" : "hidden"
            }`}
          >
            <InvestigatorSheet state={session.state} />
          </div>
          <div
            className={`min-h-0 flex-1 overflow-y-auto p-3 md:hidden ${
              mobilePane === "scene" ? "block" : "hidden"
            }`}
          >
            <RoomMap state={session.state} />
          </div>
          <div
            className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-3 md:hidden ${
              mobilePane === "record" ? "block" : "hidden"
            }`}
          >
            <RecordColumn
              state={session.state}
              log={session.log}
              budgetChars={session.config.contextBudgetChars}
              lastUsage={session.lastUsage}
              lastTrace={session.config.debugTrace ? session.lastTrace : null}
              showTrace={session.config.debugTrace}
              branches={session.branches}
              currentBranch={session.branchId}
              busy={session.busy}
              onRewind={rewindTo}
              onSwitch={switchTo}
            />
          </div>
          <Composer
            suggestions={session.suggestions}
            busy={session.busy}
            canRetell={session.canRetell && session.config.enabled}
            onSuggestion={actFromSuggestion}
            onSay={sayText}
            onRetell={() => void session.retell()}
          />
        </main>

        <aside className="hidden min-h-0 min-w-0 flex-col gap-3 overflow-y-auto md:flex">
          <RecordColumn
            state={session.state}
            log={session.log}
            budgetChars={session.config.contextBudgetChars}
            lastUsage={session.lastUsage}
            lastTrace={session.config.debugTrace ? session.lastTrace : null}
            showTrace={session.config.debugTrace}
            branches={session.branches}
            currentBranch={session.branchId}
            busy={session.busy}
            onRewind={rewindTo}
            onSwitch={switchTo}
          />
        </aside>
      </div>

      <nav aria-label="桌面栏目" className="flex shrink-0 border-t border-line/60 md:hidden">
        {PANES.map((pane) => (
          <button
            key={pane.id}
            type="button"
            onClick={() => setMobilePane(pane.id)}
            aria-current={mobilePane === pane.id ? "page" : undefined}
            className={`min-h-11 min-w-0 flex-1 px-1 text-[13px] ${
              mobilePane === pane.id ? "bg-ink-3 text-brass" : "text-muted"
            }`}
          >
            {pane.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function SessionChip({
  version,
  events,
  backend,
  durable,
  note,
}: {
  version: number;
  events: number;
  backend: string;
  durable: boolean;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="这一场的版本和存档"
        className={`relative min-h-11 shrink-0 rounded border px-2 text-[12px] tabular-nums md:hidden ${
          durable ? "border-line/70 text-muted" : "border-blood/50 text-blood"
        }`}
      >
        v{version}
        {open ? (
          <span className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-line/70 bg-ink-2 p-2 text-left text-[11px] leading-5 font-normal text-paper shadow-xl">
            状态版本 v{version} · 事件 {events} 条
            <br />
            存档：{backend}
            {durable ? "" : "（关掉页面就没了）"}
            {note ? (
              <>
                <br />
                {note}
              </>
            ) : null}
          </span>
        ) : null}
      </button>
      <span className="hidden rounded border border-line/60 px-2 py-0.5 text-[11px] text-muted md:inline">
        状态版本 v{version} · 事件 {events} 条
      </span>
      <span
        title={note ?? undefined}
        className={`hidden rounded border px-2 py-0.5 text-[11px] md:inline ${
          durable ? "border-line/60 text-muted" : "border-blood/50 text-blood"
        }`}
      >
        存档：{backend}
        {durable ? "" : "（关掉页面就没了）"}
      </span>
    </>
  );
}

function RecordColumn({
  state,
  log,
  budgetChars,
  lastUsage,
  lastTrace,
  showTrace,
  branches,
  currentBranch,
  busy,
  onRewind,
  onSwitch,
}: {
  state: GameState;
  log: GameEvent[];
  budgetChars: number;
  lastUsage: ReturnType<typeof useSession>["lastUsage"];
  lastTrace: ReturnType<typeof useSession>["lastTrace"];
  showTrace: boolean;
  branches: ReturnType<typeof useSession>["branches"];
  currentBranch: string | null;
  busy: boolean;
  onRewind: (mark: TurnMark) => void;
  onSwitch: (branchId: string) => void;
}) {
  return (
    <>
      <Inventory state={state} />
      <Clues state={state} />
      <StoryFlags state={state} />
      <Timeline
        log={log}
        branches={branches}
        currentBranch={currentBranch}
        busy={busy}
        onRewind={onRewind}
        onSwitch={onSwitch}
      />
      <EventLog log={log} />
      <ContextUsagePanel state={state} budgetChars={budgetChars} lastUsage={lastUsage} />
      {showTrace ? <JobTracePanel trace={lastTrace} /> : null}
    </>
  );
}
