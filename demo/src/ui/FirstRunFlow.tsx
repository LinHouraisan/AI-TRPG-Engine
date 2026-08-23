import { useState } from "react";
import { activePackId, pack } from "@/engine/pack";

export function FirstRunFlow({ version }: { version: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (version > 0 || dismissed || activePackId !== "mist-harbor") return null;
  return (
    <section className="border-b border-brass/40 bg-brass/5 p-3 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-base text-brass">开始《{pack.manifest.title}》</h2>
          <p className="mt-1 text-muted">1. 设置中测试 DeepSeek　2. 导入或确认调查员　3. 阅读开场　4. 用建议行动或自由输入开始。</p>
          <p className="mt-1">{pack.manifest.opening}</p>
        </div>
        <button type="button" onClick={() => setDismissed(true)} className="shrink-0 rounded border border-line/70 px-2 py-1">我准备好了</button>
      </div>
    </section>
  );
}
