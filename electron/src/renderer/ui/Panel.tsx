import type { ReactNode } from "react";

export function Panel({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-line/60 bg-ink-2/70 backdrop-blur-sm ${className}`}
    >
      <header className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line/50 px-3 py-2">
        <h2 className="shrink-0 text-xs font-medium tracking-widest text-brass">{title}</h2>
        {hint ? <span className="min-w-0 truncate text-[11px] text-muted">{hint}</span> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-paper">{value}</span>
    </div>
  );
}

export function Meter({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "blood" | "moss" | "brass";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar =
    tone === "blood" ? "bg-blood" : tone === "moss" ? "bg-moss" : "bg-brass";
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          {value} <span className="text-muted">/ {max}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-3">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
