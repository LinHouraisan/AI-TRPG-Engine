import { useState } from "react";
import { activePackId, pack } from "@core/engine/pack";

export function FirstRunFlow({ version, confirmed }: { version: number; confirmed: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (!confirmed || version > 1 || dismissed || activePackId !== "mist-harbor") return null;
  return (
    <section className="border-b border-brass/40 bg-brass/5 p-3 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-base text-brass">开始《{pack.manifest.title}》</h2>
          <p className="mt-1 text-muted">调查员已经写入本场战役。阅读守秘人的正式开场，再用建议行动或自由输入开始。</p>
        </div>
        <button type="button" onClick={() => setDismissed(true)} className="shrink-0 rounded border border-line/70 px-2 py-1">我准备好了</button>
      </div>
    </section>
  );
}
