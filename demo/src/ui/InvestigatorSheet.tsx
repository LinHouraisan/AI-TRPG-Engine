import { investigator } from "@/data/boarding-house";
import type { GameState } from "@/engine/types";
import { Meter, Panel, Row } from "./Panel";

export function InvestigatorSheet({ state }: { state: GameState }) {
  return (
    <Panel title="调查员卡" hint="数值只能由程序改">
      <div className="flex items-baseline justify-between">
        <span className="font-serif text-lg">{investigator.name}</span>
        <span className="text-xs text-muted">{investigator.occupation}</span>
      </div>
      <div className="mt-2">
        <Meter label="生命值" value={state.hp} max={state.hpMax} tone="blood" />
        <Meter label="理智" value={state.san} max={investigator.san} tone="moss" />
      </div>
      <div className="mt-3 border-t border-line/50 pt-2">
        {Object.entries(state.skills).map(([name, value]) => (
          <Row key={name} label={name} value={<span className="tabular-nums">{value}</span>} />
        ))}
      </div>
    </Panel>
  );
}
