import type { InvestigatorProfile } from "@core/character/types";
import { pack, packIndex } from "@core/engine/pack";
import { difficultyLabel } from "@core/engine/rules";
import type { GameState } from "@core/engine/types";
import type { ActiveCheckPreview } from "@renderer/session";
import { CheckCard } from "./CheckCard";
import { Meter, Panel, Row } from "./Panel";

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
  const history = pack.manifest.creation?.lifeHistories.find((candidate) => candidate.id === profile.lifeHistoryId);
  const relationships = Object.entries(state.relationships ?? {});
  return (
    <Panel title="调查员卡" hint="开局确认 · 不可编辑">
      <div className="flex items-baseline justify-between">
        <span className="font-serif text-lg">{profile.name}</span>
        <span className="text-xs text-muted">{profile.occupation}</span>
      </div>
      <div className="mt-2">
        <Meter label="生命值" value={state.hp} max={state.hpMax} tone="blood" />
        <Meter label="理智" value={state.san} max={state.sanMax} tone="moss" />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1 border-t border-line/50 pt-2">
        {Object.entries(profile.characteristics).map(([name, value]) => (
          <div key={name} className="rounded bg-ink-3/45 p-1.5 text-center">
            <div className="text-[10px] text-muted">{name}</div>
            <div className="text-sm tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {history ? (
        <div className="mt-3 border-t border-line/50 pt-2 text-xs leading-5">
          <p className="text-brass">{history.title}</p>
          <p className="mt-1 text-muted">{history.background}</p>
          <p className="mt-1">扮演提示：{history.roleplayPrompt}</p>
        </div>
      ) : null}

      {relationships.length > 0 ? (
        <div className="mt-3 border-t border-line/50 pt-2">
          <p className="mb-1 text-[11px] tracking-widest text-brass">公开关系</p>
          {relationships.map(([npcId, text]) => (
            <p key={npcId} className="text-xs leading-5"><span className="text-muted">{packIndex.npc(npcId)?.title ?? npcId}：</span>{text}</p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 border-t border-line/50 pt-2">
        {Object.entries(profile.skills).map(([name, value]) => (
          <details key={name} className="group border-b border-line/25 last:border-0">
            <summary className="cursor-pointer list-none">
              <Row label={name} value={<span className="tabular-nums">{value}</span>} />
            </summary>
            <div className="pb-2 pl-3 text-[11px] text-muted">
              基础 {profile.baseSkills[name] ?? 0} + 职业 {profile.occupationPoints[name] ?? 0} + 兴趣 {profile.interestPoints[name] ?? 0}
            </div>
          </details>
        ))}
      </div>

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
