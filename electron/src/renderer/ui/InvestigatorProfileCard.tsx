import type { InvestigatorProfile } from "@core/character/types";
import { loadPackById } from "@core/engine/pack";
import { Meter, Row } from "./Panel";

const creationRules = loadPackById("mist-harbor").manifest.creation;
const characteristicOrder = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"] as const;

export function InvestigatorProfileCard({
  profile,
  hp,
  hpMax,
  san,
  sanMax,
  relationships = [],
}: {
  profile: InvestigatorProfile;
  hp: number;
  hpMax: number;
  san: number;
  sanMax: number;
  relationships?: string[];
}) {
  const history = creationRules?.lifeHistories.find(
    (candidate) => candidate.id === profile.lifeHistoryId,
  );
  const skillOrder = creationRules
    ? [...Object.keys(creationRules.baseSkills), ...Object.keys(profile.skills).filter((name) => !(name in creationRules.baseSkills))]
    : Object.keys(profile.skills);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-serif text-lg">{profile.name}</span>
        <span className="text-xs text-muted">{profile.occupation}</span>
      </div>
      <div className="mt-2">
        <Meter label="生命值" value={hp} max={hpMax} tone="blood" />
        <Meter label="理智" value={san} max={sanMax} tone="moss" />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1 border-t border-line/50 pt-2">
        {characteristicOrder.map((name) => (
          <div key={name} className="rounded bg-ink-3/45 p-1.5 text-center">
            <div className="text-[10px] text-muted">{name}</div>
            <div className="text-sm tabular-nums">{profile.characteristics[name]}</div>
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
          {relationships.map((text) => <p key={text} className="text-xs leading-5">{text}</p>)}
        </div>
      ) : null}

      <div className="mt-3 border-t border-line/50 pt-2">
        {skillOrder.map((name) => {
          const value = profile.skills[name];
          const base = profile.baseSkills[name] ?? 0;
          const occupation = profile.occupationPoints[name] ?? 0;
          const interest = profile.interestPoints[name] ?? 0;
          return (
            <details key={name} open className="group border-b border-line/25 last:border-0">
              <summary className="cursor-pointer list-none">
                <Row label={name} value={<span className="tabular-nums">{value}</span>} />
              </summary>
              <div className="pb-2 pl-3 text-[11px] text-muted">
                基础 {base} + 职业 {occupation} + 兴趣 {interest} = 最终 {value}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
