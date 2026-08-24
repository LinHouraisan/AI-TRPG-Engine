import type { InvestigatorProfile } from "@core/character/types";
import { packIndex } from "@core/engine/pack";
import { difficultyLabel } from "@core/engine/rules";
import type { GameState } from "@core/engine/types";
import type { ActiveCheckPreview } from "@renderer/session";
import { CheckCard } from "./CheckCard";
import { InvestigatorProfileCard } from "./InvestigatorProfileCard";
import { Panel } from "./Panel";

export function InvestigatorSheet({
  state,
  profile,
  activeCheckPreview,
}: {
  state: GameState;
  profile: InvestigatorProfile | null;
  activeCheckPreview: ActiveCheckPreview;
}) {
  if (!profile) {
    return (
      <Panel title="调查员卡" hint="尚未确认">
        <p className="text-sm leading-6 text-muted">完成开局创建后，调查员资料与检定反馈会显示在这里。</p>
      </Panel>
    );
  }
  const relationships = Object.entries(state.relationships ?? {});
  return (
    <Panel title="调查员卡" hint="开局确认 · 不可编辑">
      <InvestigatorProfileCard
        profile={profile}
        hp={state.hp}
        hpMax={state.hpMax}
        san={state.san}
        sanMax={state.sanMax}
        relationships={relationships.map(([npcId, text]) => `${packIndex.npc(npcId)?.title ?? npcId}：${text}`)}
      />

      {activeCheckPreview ? (
        <div className="mt-3 border-t border-line/50 pt-2">
          <p className="text-[11px] tracking-widest text-brass">当前检定</p>
          {activeCheckPreview.kind === "candidate" ? (
            <div className="mt-2 rounded border border-brass/40 bg-brass/5 p-2 text-xs">
              <p>{activeCheckPreview.check.skill} · {difficultyLabel(activeCheckPreview.check.difficulty)}难度</p>
              <p className="mt-1 text-muted">候选门槛 {activeCheckPreview.check.threshold}，尚未掷骰。</p>
            </div>
          ) : <CheckCard check={activeCheckPreview.check} />}
        </div>
      ) : null}
    </Panel>
  );
}
