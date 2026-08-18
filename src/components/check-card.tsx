import type { CheckResult } from "@/lib/check";
import { cn } from "@/lib/utils";

function isCheckResult(value: unknown): value is CheckResult {
  return (
    typeof value === "object" &&
    value != null &&
    "ok" in value &&
    "roll" in value &&
    "threshold" in value &&
    "skill" in value &&
    "die" in value
  );
}

export function CheckCard({ output }: { output: unknown }) {
  if (!isCheckResult(output)) return null;
  const max = output.pack === "percentile" ? 100 : Math.max(20, output.dc + 5);
  const rollPct = Math.min(100, (output.total / max) * 100);
  const dcPct = Math.min(100, (output.threshold / max) * 100);

  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {output.who} · {output.skill}
          {output.target ? ` · ${output.target}` : ""}
        </span>
        <span
          className={cn(
            "whitespace-nowrap font-medium",
            output.ok ? "text-emerald-700" : "text-destructive",
          )}
        >
          {output.ok ? "成功" : "失败"}
        </span>
      </div>
      <div className="relative mt-3 h-2 rounded-sm bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-destructive/40"
          style={{ width: `${dcPct}%` }}
        />
        <div
          className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-foreground"
          style={{ left: `${rollPct}%` }}
        />
      </div>
      <p className="mt-2 whitespace-nowrap text-muted-foreground">
        {output.die} {output.total}
        {output.pack === "d20" ? `（${output.roll}${output.modifier >= 0 ? "+" : ""}${output.modifier}）` : ""}
        {" / "}
        {output.pack === "percentile" ? `技能 ${output.skillValue}` : `难度 ${output.dc}`}
      </p>
    </div>
  );
}
