import { useEffect, useMemo, useState } from "react";
import type { CandidateStatus, DatasetUsage, DiagnosisCode } from "@core/audit/types";
import {
  desktopApi,
  type DesktopAuditCase,
  type DesktopCandidate,
} from "@renderer/desktop";
import { validateCandidateReview } from "./audit-feedback-state";

const STATUSES: CandidateStatus[] = [
  "captured",
  "pending_review",
  "reviewed",
  "curated",
  "exported",
  "discarded",
];
const DIAGNOSIS_CODES: DiagnosisCode[] = [
  "PROVIDER_FAILURE",
  "CONTRACT_FAILURE",
  "GUARD_REJECTION",
  "STALE_STATE",
  "ROUTE_INVALID",
  "ROUTE_UNCERTAIN",
  "CONTEXT_TRUNCATED",
  "CONTEXT_MISSING",
  "RETRIEVAL_MISS",
  "RETRIEVAL_NOISE",
  "EVENT_NARRATION_MISMATCH",
  "GENERATION_DRIFT",
  "STYLE_OR_PREFERENCE",
  "UNKNOWN",
];

export function AuditReviewPanel({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose(): void;
}) {
  const api = desktopApi();
  const [items, setItems] = useState<DesktopCandidate[]>([]);
  const [selected, setSelected] = useState<DesktopAuditCase | null>(null);
  const [status, setStatus] = useState<CandidateStatus | "">("");
  const [query, setQuery] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [showNonCausal, setShowNonCausal] = useState(false);
  const [datasetUsage, setDatasetUsage] = useState<DatasetUsage>("evaluation_only");
  const [targetStatus, setTargetStatus] = useState<"reviewed" | "curated" | "discarded">("reviewed");
  const [tags, setTags] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [correctedOutput, setCorrectedOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    if (!api) return;
    const result = await api.audit.listCandidates({
      campaignId,
      status: status || undefined,
      limit: 100,
    });
    if (result.ok) setItems(result.value.items);
    else setError(result.error.messageKey);
  };

  useEffect(() => { void reload(); }, [campaignId, status]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const after = createdAfter ? Date.parse(createdAfter) : Number.NaN;
    return items.filter((item) => {
      if (!Number.isNaN(after) && Date.parse(item.createdAt) < after) return false;
      if (!needle) return true;
      return [
        item.caseId,
        ...item.taskTypes,
        ...item.modelIds,
        ...item.promptVersions,
        ...item.diagnoses.map((diagnosis) => diagnosis.code),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [createdAfter, items, query]);

  const openCandidate = async (caseId: string) => {
    if (!api) return;
    const result = await api.audit.getCandidate({ campaignId, caseId });
    if (!result.ok) {
      setError(result.error.messageKey);
      return;
    }
    setSelected(result.value);
    setTags(result.value.candidate.confirmedIssueTags.join(", "));
    setReviewNote(result.value.candidate.reviewNote ?? "");
    setCorrectedOutput(result.value.candidate.correctedOutput ?? "");
    setDatasetUsage(result.value.candidate.datasetUsage ?? "evaluation_only");
    setError(null);
  };

  const saveReview = async () => {
    if (!api || !selected) return;
    const validation = validateCandidateReview({ datasetUsage, correctedOutput });
    if (validation) {
      setError(validation);
      return;
    }
    const confirmedIssueTags = tags.split(/[,，\s]+/).filter(isDiagnosisCode);
    const result = await api.audit.reviewCandidate({
      campaignId,
      caseId: selected.candidate.caseId,
      status: targetStatus,
      confirmedIssueTags,
      reviewNote: reviewNote || undefined,
      correctedOutput: correctedOutput || undefined,
      datasetUsage,
    });
    if (!result.ok) {
      setError(result.error.messageKey);
      return;
    }
    setSelected({ ...selected, candidate: result.value });
    setError(null);
    await reload();
  };

  const spans = selected?.audit.spans.filter((span) => showNonCausal || span.causal) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-3 md:p-8" role="dialog" aria-modal="true">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-lg border border-line bg-ink-2 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line/70 px-4 py-3">
          <div>
            <h2 className="font-serif text-lg text-brass">审计数据池</h2>
            <p className="text-xs text-muted">回看证据、人工修订并选择数据用途</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-line px-3 py-1 text-sm">关闭</button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-line/60 p-3">
            <div className="grid gap-2">
              <select value={status} onChange={(event) => setStatus(event.target.value as CandidateStatus | "")} className="rounded bg-ink-3 p-2 text-xs">
                <option value="">全部状态</option>
                {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="任务 / 模型 / Prompt / 诊断码" className="rounded bg-ink-3 p-2 text-xs" />
              <input type="date" value={createdAfter} onChange={(event) => setCreatedAfter(event.target.value)} className="rounded bg-ink-3 p-2 text-xs" />
            </div>
            <div className="mt-3 space-y-2">
              {filtered.map((item) => (
                <button key={item.caseId} type="button" onClick={() => void openCandidate(item.caseId)} className="block w-full rounded border border-line/60 p-2 text-left text-xs hover:border-brass/60">
                  <div className="flex justify-between gap-2"><span>{item.status}</span><span className="text-muted">{item.createdAt.slice(0, 10)}</span></div>
                  <div className="mt-1 truncate text-muted">{item.caseId}</div>
                  <div className="mt-1 text-brass">{item.diagnoses.map((item) => item.code).join(" · ") || "待诊断"}</div>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4">
            {!selected ? <p className="text-sm text-muted">选择一条候选查看完整链路。</p> : (
              <div className="space-y-5">
                <section>
                  <h3 className="text-sm text-brass">最终回复与反馈</h3>
                  <p className="mt-2 whitespace-pre-wrap font-serif text-sm leading-6">{selected.finalOutput}</p>
                  <p className="mt-2 text-xs text-muted">{selected.feedback.note || "用户未填写说明"}</p>
                </section>

                <section>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm text-brass">链路证据</h3>
                    <label className="text-xs text-muted"><input type="checkbox" checked={showNonCausal} onChange={(event) => setShowNonCausal(event.target.checked)} /> 显示非因果 Span</label>
                  </div>
                  <div className="mt-2 space-y-2">
                    {spans.map((span) => (
                      <details key={span.spanId} className="rounded border border-line/50 bg-ink-3/40 p-2 text-xs">
                        <summary className="cursor-pointer">#{span.sequence} · {span.stage} · {span.status}{span.causal ? " · causal" : ""}</summary>
                        <div className="mt-2 text-muted">错误：{span.errorCode ?? "无"} · Token：{span.promptTokens}/{span.completionTokens}/{span.cachedTokens}</div>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify({ input: span.input, output: span.output }, null, 2)}</pre>
                      </details>
                    ))}
                  </div>
                </section>

                <section className="grid gap-2 rounded border border-line/60 p-3">
                  <h3 className="text-sm text-brass">人工处理</h3>
                  <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="确认标签，逗号分隔" className="rounded bg-ink-3 p-2 text-xs" />
                  <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="复核说明" className="min-h-16 rounded bg-ink-3 p-2 text-xs" />
                  <textarea value={correctedOutput} onChange={(event) => setCorrectedOutput(event.target.value)} placeholder="人工修订后的正确回复" className="min-h-28 rounded bg-ink-3 p-2 text-xs" />
                  <div className="flex flex-wrap gap-2">
                    <select value={datasetUsage} onChange={(event) => setDatasetUsage(event.target.value as DatasetUsage)} className="rounded bg-ink-3 p-2 text-xs">
                      <option value="evaluation_only">evaluation_only</option>
                      <option value="sft">sft</option>
                      <option value="preference">preference</option>
                      <option value="discard">discard</option>
                    </select>
                    <select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value as typeof targetStatus)} className="rounded bg-ink-3 p-2 text-xs">
                      <option value="reviewed">reviewed</option>
                      <option value="curated">curated</option>
                      <option value="discarded">discarded</option>
                    </select>
                    <button type="button" onClick={() => void saveReview()} className="rounded border border-brass/60 px-3 py-1 text-xs text-brass">保存复核</button>
                  </div>
                  {error ? <p className="text-xs text-blood">{error}</p> : null}
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function isDiagnosisCode(value: string): value is DiagnosisCode {
  return DIAGNOSIS_CODES.includes(value as DiagnosisCode);
}
