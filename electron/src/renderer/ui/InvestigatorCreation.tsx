import { useReducer } from "react";
import { allocationBudget, validateAllocation } from "@core/character/creation";
import type { InvestigatorAllocation, InvestigatorCreationRules } from "@core/character/types";
import { pack } from "@core/engine/pack";
import {
  creationReducer,
  canSubmitConfirmation,
  initialCreationState,
  type CreationStep,
} from "./investigator-creation-state";
import { InvestigatorProfileCard } from "./InvestigatorProfileCard";

const STEPS: Array<{ id: CreationStep; label: string }> = [
  { id: "premise", label: "前提" },
  { id: "occupation", label: "职业" },
  { id: "skills", label: "技能" },
  { id: "history", label: "经历" },
  { id: "review", label: "确认" },
];

export function InvestigatorCreation({
  rules,
  busy,
  ready,
  error,
  onConfirm,
}: {
  rules: InvestigatorCreationRules;
  busy: boolean;
  ready: boolean;
  error: string | null;
  onConfirm: (allocation: InvestigatorAllocation) => Promise<boolean>;
}) {
  const [state, dispatch] = useReducer(creationReducer, rules, initialCreationState);
  const budget = allocationBudget(rules);
  const occupationSpent = sum(state.allocation.occupationPoints);
  const interestSpent = sum(state.allocation.interestPoints);
  const history = rules.lifeHistories.find((candidate) => candidate.id === state.allocation.lifeHistoryId);
  const validated = validateAllocation(rules, state.allocation);
  const reviewProfile = validated.ok ? validated.profile : null;

  function go(step: CreationStep) {
    dispatch({ type: "go", step });
  }

  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl rounded-lg border border-line/60 bg-ink-2/70">
        <header className="border-b border-line/50 p-4">
          <p className="text-[11px] tracking-[0.24em] text-muted">调查员创建</p>
          <h1 className="mt-1 font-serif text-2xl text-brass">进入《{pack.manifest.title}》</h1>
          <ol className="mt-4 grid grid-cols-5 gap-1 text-center text-[11px]">
            {STEPS.map((step) => (
              <li
                key={step.id}
                className={`rounded border px-1 py-1.5 ${
                  step.id === state.step ? "border-brass/70 bg-brass/10 text-brass" : "border-line/40 text-muted"
                }`}
              >
                {step.label}
              </li>
            ))}
          </ol>
        </header>

        {error ? (
          <p role="alert" className="mx-4 mt-4 rounded border border-blood/60 bg-blood/10 px-3 py-2 text-sm text-blood">
            {error}
          </p>
        ) : null}

        <div className="space-y-4 p-4 md:p-5">
          {state.step === "premise" ? (
            <>
              <h2 className="font-serif text-xl">一场关于雾港、失踪者与被抹去记录的调查</h2>
              <p className="text-sm leading-7 text-muted">
                正式开场会在调查员确认后出现。先完成固定职业、技能点和一段人生经历。
              </p>
              <Navigation next={() => go("occupation")} />
            </>
          ) : null}

          {state.step === "occupation" ? (
            <>
              <label className="block text-sm">
                <span className="text-muted">姓名</span>
                <input
                  value={state.allocation.name}
                  onChange={(event) => dispatch({ type: "set-name", name: event.currentTarget.value })}
                  className="mt-1 w-full rounded border border-line/70 bg-ink-3 px-3 py-2"
                />
              </label>
              <p className="text-sm">固定职业：<span className="text-brass">{rules.occupation}</span></p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {Object.entries(rules.characteristics).map(([name, value]) => (
                  <div key={name} className="rounded border border-line/50 bg-ink-3/40 p-2 text-center">
                    <div className="text-[11px] text-muted">{name}</div>
                    <div className="tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
              <Navigation back={() => go("premise")} next={() => go("skills")} />
            </>
          ) : null}

          {state.step === "skills" ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Pool label="职业点剩余" remaining={budget.occupation - occupationSpent} />
                <Pool label="兴趣点剩余" remaining={budget.interest - interestSpent} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr><th className="py-2">技能 / 基础</th><th>职业点</th><th>兴趣点</th><th className="text-right">最终</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(rules.baseSkills).map(([skill, base]) => {
                      const occupation = state.allocation.occupationPoints[skill] ?? 0;
                      const interest = state.allocation.interestPoints[skill] ?? 0;
                      const final = base + occupation + interest;
                      const occupationMax = occupation + Math.min(
                        budget.occupation - occupationSpent,
                        rules.maxSkill - final,
                      );
                      const interestMax = interest + Math.min(
                        budget.interest - interestSpent,
                        rules.maxSkill - final,
                      );
                      return (
                        <tr key={skill} className="border-t border-line/35">
                          <td className="py-2">
                            {skill} <span className="text-muted">{base}</span>
                            {final === rules.maxSkill ? <span className="ml-2 text-[11px] text-brass">已达上限</span> : null}
                          </td>
                          <td>
                            {rules.occupationSkills.includes(skill) ? (
                              <PointInput
                                value={occupation}
                                max={occupationMax}
                                onChange={(value) => dispatch({ type: "set-points", pool: "occupation", skill, value })}
                              />
                            ) : <span className="text-muted">—</span>}
                          </td>
                          <td>
                            <PointInput
                              value={interest}
                              max={interestMax}
                              onChange={(value) => dispatch({ type: "set-points", pool: "interest", skill, value })}
                            />
                          </td>
                          <td className="text-right tabular-nums">{final}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <IssueList issues={state.issues.map((issue) => issue.message)} />
              <Navigation back={() => go("occupation")} next={() => go("history")} />
            </>
          ) : null}

          {state.step === "history" ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {rules.lifeHistories.map((candidate) => (
                  <label
                    key={candidate.id}
                    className={`cursor-pointer rounded border p-3 ${
                      state.allocation.lifeHistoryId === candidate.id ? "border-brass/70 bg-brass/10" : "border-line/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="life-history"
                      value={candidate.id}
                      checked={state.allocation.lifeHistoryId === candidate.id}
                      onChange={() => dispatch({ type: "select-history", lifeHistoryId: candidate.id })}
                      className="mr-2"
                    />
                    <span className="text-brass">{candidate.title}</span>
                    <p className="mt-2 text-xs leading-5 text-muted">{candidate.background}</p>
                    <p className="mt-2 text-xs">关系：{candidate.relationship.text}</p>
                  </label>
                ))}
              </div>
              <IssueList issues={state.issues.map((issue) => issue.message)} />
              <Navigation back={() => go("skills")} next={() => go("review")} />
            </>
          ) : null}

          {state.step === "review" ? (
            <>
              {reviewProfile ? (
                <div className="rounded border border-line/50 bg-ink-3/35 p-4">
                  <InvestigatorProfileCard
                    profile={reviewProfile}
                    hp={reviewProfile.hp}
                    hpMax={reviewProfile.hp}
                    san={reviewProfile.san}
                    sanMax={reviewProfile.sanMax}
                    relationships={history ? [history.relationship.text] : []}
                  />
                </div>
              ) : null}
              <IssueList issues={state.issues.map((issue) => issue.message)} />
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => go("history")} className="rounded border border-line/70 px-3 py-2 text-sm">上一步</button>
                <button
                  type="button"
                  disabled={!canSubmitConfirmation({ ready, busy, issueCount: state.issues.length })}
                  onClick={() => void onConfirm(state.allocation)}
                  className="rounded border border-brass/70 bg-brass/10 px-4 py-2 text-sm text-brass disabled:opacity-40"
                >
                  {busy ? "正在确认…" : "确认调查员并开始"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PointInput({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="size-8 rounded border border-line/60">−</button>
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          onChange(Number.isNaN(next) ? 0 : next);
        }}
        className="w-16 rounded border border-line/60 bg-ink-3 px-2 py-1.5 text-center tabular-nums"
      />
      <button
        type="button"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="size-8 rounded border border-line/60 disabled:opacity-35"
      >+</button>
    </div>
  );
}

function Pool({ label, remaining }: { label: string; remaining: number }) {
  return (
    <div className={`rounded border p-3 ${remaining === 0 ? "border-moss/60" : "border-brass/50"}`}>
      <span className="text-xs text-muted">{label}</span>
      <span className="ml-2 text-lg tabular-nums">{remaining}</span>
    </div>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return <ul className="space-y-1 text-xs text-blood">{issues.map((issue) => <li key={issue}>· {issue}</li>)}</ul>;
}

function Navigation({ back, next }: { back?: () => void; next: () => void }) {
  return (
    <div className="flex justify-between gap-3">
      {back ? <button type="button" onClick={back} className="rounded border border-line/70 px-3 py-2 text-sm">上一步</button> : <span />}
      <button type="button" onClick={next} className="rounded border border-brass/70 px-3 py-2 text-sm text-brass">下一步</button>
    </div>
  );
}

function sum(points: Record<string, number>): number {
  return Object.values(points).reduce((total, value) => total + value, 0);
}
