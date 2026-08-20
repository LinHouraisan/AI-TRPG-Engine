import { difficultyLabel } from "@/engine/rules";
import type { PendingAction, PendingCheck } from "@/session";

export type { PendingAction, PendingCheck };

export type WaitLine = {
  primary: string;
  detail: string | null;
  check: PendingCheck | null;
};

export function formatPendingCheck(check: PendingCheck): string {
  const diff = difficultyLabel(check.difficulty);
  return `正在检定：${check.title}（${check.skill} ${check.skillValue}／${diff} ${check.threshold}）`;
}

export function composeWait(params: {
  busy: boolean;
  status: string | null;
  pending: PendingAction | null;
}): WaitLine | null {
  const { busy, status, pending } = params;
  if (!busy && !status) return null;
  if (pending?.check) {
    return { primary: formatPendingCheck(pending.check), detail: status, check: pending.check };
  }
  if (status) return { primary: status, detail: null, check: null };
  if (pending?.label) {
    return { primary: `正在处理：${pending.label}`, detail: null, check: null };
  }
  if (busy) return { primary: "正在处理这一回合…", detail: null, check: null };
  return null;
}
