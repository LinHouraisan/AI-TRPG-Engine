import { useEffect, useRef, useState } from "react";
import { importTavernCard } from "@/cards/import";
import type { CardImportDraft } from "@/cards/types";
import { characteristicList } from "@/cards/autocar";
import { Panel, Row } from "./Panel";

export function CardImport() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardImportDraft | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function load(file: File) {
    setError(null);
    void file.arrayBuffer().then((buffer) => {
      const result = importTavernCard(new Uint8Array(buffer), file.name);
      if (!result.ok) {
        setDraft(null);
        setError(result.message);
        return;
      }
      setDraft(result.draft);
    });
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="min-h-11 rounded border border-line/70 px-2.5 text-[13px] transition hover:border-brass/60 hover:text-brass md:min-h-0 md:px-2.5 md:py-1"
      >
        人设卡
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border border-line/70 bg-ink-2 p-3 shadow-lg">
          <p className="text-[11px] leading-relaxed text-muted">
            酒馆卡原型。能力是<strong className="text-brass">人设卡</strong>
            ，自动车数值标成候选，不写进这场战役，也不当成模组。
          </p>
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="mt-2 min-h-11 w-full rounded border border-line/70 px-2 py-1 text-[13px] hover:border-brass/60"
          >
            打开 JSON / PNG
          </button>
          <input
            ref={picker}
            type="file"
            accept=".json,application/json,image/png,.png"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) load(file);
            }}
          />
          {error ? <p className="mt-2 text-[12px] text-blood">{error}</p> : null}
          {draft ? <DraftView draft={draft} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function DraftView({ draft }: { draft: CardImportDraft }) {
  const { card, sheet } = draft;
  const chars = sheet.characteristics.value;
  return (
    <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
      <Panel title="能力" hint="不是模组">
        <Row label="等级" value="人设卡" />
        <Row label="规格" value={card.spec} />
        <Row label="确认" value="未确认 · 候选" />
      </Panel>
      <Panel title={card.name} hint={sheet.occupation.value}>
        <p className="text-[12px] leading-relaxed text-paper/90">{card.description || "（没有描述）"}</p>
        {card.worldBook.length > 0 ? (
          <p className="mt-2 text-[11px] text-muted">世界书 {card.worldBook.length} 条</p>
        ) : null}
      </Panel>
      <Panel title="自动车" hint="由描述与世界观生成">
        <div className="grid grid-cols-4 gap-1 text-[11px] tabular-nums">
          {characteristicList().map((id) => (
            <div key={id} className="flex justify-between gap-1 border border-line/40 px-1.5 py-0.5">
              <span className="text-muted">{id}</span>
              <span>{chars[id]}</span>
            </div>
          ))}
        </div>
        <div className="mt-2">
          <Row label="生命值" value={<span className="tabular-nums">{sheet.hp.value}</span>} />
          <Row label="理智" value={<span className="tabular-nums">{sheet.san.value} / {sheet.sanMax.value}</span>} />
        </div>
        <div className="mt-2 border-t border-line/40 pt-1">
          {Object.entries(sheet.skills.value)
            .filter(([, value]) => value > 25)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 8)
            .map(([name, value]) => (
              <Row key={name} label={name} value={<span className="tabular-nums">{value}</span>} />
            ))}
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-muted">
          {sheet.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
