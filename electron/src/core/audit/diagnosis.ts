import type {
  AuditCase,
  AuditSpanRecord,
  DiagnosisCode,
  JsonObject,
} from "./types";

export const TURN_DIAGNOSIS_RULE_VERSION = "turn-diagnosis-v1";

export type DiagnosisConfidence = "high" | "medium" | "low";
export type DiagnosisSeverity = "error" | "warning" | "info";

export interface TurnDiagnosis {
  code: DiagnosisCode;
  confidence: DiagnosisConfidence;
  severity: DiagnosisSeverity;
  explanation: string;
  evidenceSpanIds: string[];
  ruleVersion: typeof TURN_DIAGNOSIS_RULE_VERSION;
}

type Rule = {
  code: Exclude<DiagnosisCode, "UNKNOWN">;
  confidence: DiagnosisConfidence;
  severity: DiagnosisSeverity;
  explanation: string;
  matches(span: AuditSpanRecord): boolean;
};

const PROVIDER_ERRORS = new Set([
  "TIMEOUT",
  "NETWORK",
  "HTTP",
  "EMPTY_RESPONSE",
  "PROVIDER_FAILURE",
  "ABORTED",
  "AUTH",
  "BALANCE",
  "RATE_LIMIT",
  "MODEL_NOT_FOUND",
  "SERVER",
]);

const RULES: Rule[] = [
  {
    code: "PROVIDER_FAILURE",
    confidence: "high",
    severity: "error",
    explanation: "模型调用失败或最终因供应方失败退回模板。",
    matches: (span) =>
      (span.status === "failed" && PROVIDER_ERRORS.has(span.errorCode ?? ""))
      || (span.stage === "narration.select"
        && span.output?.source === "模板"
        && Boolean(span.output.sourceSpanId)
        && span.output.fallbackReason === "provider_failure"),
  },
  {
    code: "CONTRACT_FAILURE",
    confidence: "high",
    severity: "error",
    explanation: "模型回复未通过 JSON 或 Schema 契约校验。",
    matches: (span) => span.kind === "model"
      && span.status === "failed"
      && (span.errorCode === "CONTRACT" || span.errorCode === "MALFORMED"),
  },
  {
    code: "GUARD_REJECTION",
    confidence: "high",
    severity: "error",
    explanation: "模型结果被质量、事实或结构化 Guard 拒绝。",
    matches: (span) => span.kind === "guard"
      && span.status === "rejected"
      && !["STALE_STATE", "ROUTE_INVALID"].includes(span.errorCode ?? ""),
  },
  {
    code: "STALE_STATE",
    confidence: "high",
    severity: "error",
    explanation: "处理所依据的状态版本与提交时权威版本不一致。",
    matches: (span) => span.errorCode === "STALE_STATE"
      || (span.stage === "route.validate" && span.output?.stateVersionMatch === false),
  },
  {
    code: "ROUTE_INVALID",
    confidence: "high",
    severity: "error",
    explanation: "模型路由目标或调查入口被程序判定为不可用。",
    matches: (span) => span.errorCode === "ROUTE_INVALID"
      || (span.stage === "route.validate" && span.output?.valid === false),
  },
  {
    code: "ROUTE_UNCERTAIN",
    confidence: "medium",
    severity: "warning",
    explanation: "玩家输入未得到稳定路由，最终进入 unclear 或多次改判。",
    matches: (span) => span.stage === "route.validate"
      && (nested(span.output, "finalIntent", "kind") === "unclear"
        || span.output?.uncertain === true
        || number(span.output?.revisionCount) > 1),
  },
  {
    code: "CONTEXT_TRUNCATED",
    confidence: "medium",
    severity: "warning",
    explanation: "上下文清单显示历史、线索或实体因预算被裁剪。",
    matches: (span) => span.stage === "context.build"
      && manifestEntries(span).some((entry) => entry.included === false && entry.dropReason === "budget"),
  },
  {
    code: "CONTEXT_MISSING",
    confidence: "high",
    severity: "error",
    explanation: "结构化证据指出本轮所需来源没有进入最终上下文。",
    matches: (span) => span.stage === "context.build"
      && array(span.output?.missingRequiredSourceIds).length > 0,
  },
  {
    code: "RETRIEVAL_MISS",
    confidence: "medium",
    severity: "warning",
    explanation: "检索未命中本轮明确需要的已知事实。",
    matches: (span) => span.stage === "retrieval.context"
      && array(span.output?.expectedFactIds).length > 0
      && array(span.output?.hits).length === 0,
  },
  {
    code: "RETRIEVAL_NOISE",
    confidence: "medium",
    severity: "warning",
    explanation: "检索结果含结构化标记的低质、过期或无关命中。",
    matches: (span) => span.stage === "retrieval.context"
      && (array(span.output?.noisyHitIds).length > 0
        || array(span.output?.hits).some((hit) => object(hit)?.relevant === false || object(hit)?.stale === true)),
  },
  {
    code: "EVENT_NARRATION_MISMATCH",
    confidence: "high",
    severity: "error",
    explanation: "一致性检查明确发现最终叙述与已提交事件冲突。",
    matches: (span) => span.stage === "narration.consistency" && span.output?.eventMismatch === true,
  },
  {
    code: "GENERATION_DRIFT",
    confidence: "medium",
    severity: "warning",
    explanation: "一致性检查明确标记生成内容偏离已提供证据。",
    matches: (span) => span.stage === "narration.consistency" && span.output?.semanticDrift === true,
  },
  {
    code: "STYLE_OR_PREFERENCE",
    confidence: "low",
    severity: "info",
    explanation: "结构化偏好检查只发现语气、节奏或表达问题。",
    matches: (span) => span.stage === "narration.consistency" && span.output?.preferenceIssue === true,
  },
];

export function diagnoseTurn(input: AuditCase): TurnDiagnosis[] {
  const causal = causalBeforeFinalSelection(input.spans);
  const diagnoses: TurnDiagnosis[] = [];
  for (const rule of RULES) {
    const evidence = causal.find(rule.matches);
    if (!evidence) continue;
    diagnoses.push({
      code: rule.code,
      confidence: rule.confidence,
      severity: rule.severity,
      explanation: rule.explanation,
      evidenceSpanIds: [evidence.spanId],
      ruleVersion: TURN_DIAGNOSIS_RULE_VERSION,
    });
  }
  if (diagnoses.length > 0) return diagnoses;
  const fallback = [...causal].reverse().find((span) => span.stage === "narration.select")
    ?? causal[causal.length - 1];
  if (!fallback) return [];
  return [{
    code: "UNKNOWN",
    confidence: "low",
    severity: "info",
    explanation: "现有因果证据不足以解释这次差评。",
    evidenceSpanIds: [fallback.spanId],
    ruleVersion: TURN_DIAGNOSIS_RULE_VERSION,
  }];
}

function causalBeforeFinalSelection(spans: AuditSpanRecord[]): AuditSpanRecord[] {
  const causal = spans.filter((span) => span.causal).sort((left, right) => left.sequence - right.sequence);
  const selection = [...causal].reverse().find((span) => span.stage === "narration.select");
  return selection ? causal.filter((span) => span.sequence <= selection.sequence) : causal;
}

function manifestEntries(span: AuditSpanRecord): Array<Record<string, unknown>> {
  const manifest = object(span.output?.manifest);
  return array(manifest?.entries).map(object).filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function nested(value: JsonObject | null, key: string, child: string): unknown {
  return object(value?.[key])?.[child];
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function number(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
