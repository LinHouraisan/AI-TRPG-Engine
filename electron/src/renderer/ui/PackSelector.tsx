import { useEffect, useRef, useState } from "react";
import {
  activePackId,
  listPacks,
  pack,
  rememberActivePack,
  type PackListing,
} from "@core/engine/pack";

type PendingSwitch = {
  listing: PackListing;
};

/**
 * 换模组等于离开现在这场、另开一条时间线。
 * 选择只写进 localStorage，然后整页重载——引擎从模块级单例读资料包，
 * 运行时改指针会留下一半旧一半新。
 */
export function PackSelector({
  campaignVersion,
  campaignEvents,
  busy,
}: {
  campaignVersion: number;
  campaignEvents: number;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const listings = listPacks();

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function requestSwitch(listing: PackListing) {
    if (!listing.available || listing.id === activePackId || busy) return;
    setPending({ listing });
  }

  function confirmSwitch() {
    if (!pending || busy) return;
    rememberActivePack(pending.listing.id);
    window.location.reload();
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (busy) return;
          setOpen((value) => !value);
          setPending(null);
        }}
        aria-expanded={open}
        aria-label="选择模组"
        title="换一份模组会另开一场，之前那场留在库里"
        className="min-h-11 min-w-0 max-w-full text-left disabled:opacity-50 md:min-h-0"
      >
        <span className="block truncate font-serif text-[15px] md:hidden">
          {pack.manifest.title}
        </span>
        <div className="hidden items-baseline gap-2 md:flex">
          <span className="font-serif text-base tracking-wide">AI TRPG Engine</span>
          <span className="truncate text-xs text-muted">
            试玩 · 《{pack.manifest.title}》
          </span>
        </div>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="关闭模组选择"
            onClick={() => {
              setOpen(false);
              setPending(null);
            }}
            className="fixed inset-0 z-20 bg-ink/50 md:hidden"
          />
          <div className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line/70 bg-ink-2 p-3 text-[13px] shadow-xl">
            {pending ? (
              <ConfirmSwitch
                currentTitle={pack.manifest.title}
                campaignVersion={campaignVersion}
                campaignEvents={campaignEvents}
                target={pending.listing}
                busy={busy}
                onCancel={() => setPending(null)}
                onConfirm={confirmSwitch}
              />
            ) : (
              <PackList
                listings={listings}
                currentId={activePackId}
                busy={busy}
                onPick={requestSwitch}
              />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PackList({
  listings,
  currentId,
  busy,
  onPick,
}: {
  listings: PackListing[];
  currentId: string;
  busy: boolean;
  onPick: (listing: PackListing) => void;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted">换模组会另开一场，之前那场留在库里。</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {listings.map((listing) => {
          const current = listing.id === currentId;
          const disabled = !listing.available || current || busy;
          return (
            <li key={listing.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(listing)}
                className={`w-full rounded-md border px-2.5 py-2 text-left transition ${
                  current
                    ? "border-brass/60 bg-brass/10"
                    : listing.available
                      ? "border-line/70 hover:border-brass/60 hover:text-brass"
                      : "border-blood/40 text-muted"
                } disabled:cursor-not-allowed`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">《{listing.title}》</span>
                  {current ? <span className="shrink-0 text-[11px] text-brass">正在用</span> : null}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {listing.id} · {listing.version}
                  {listing.available
                    ? ` · ${listing.counts.rooms} 间房`
                    : " · 不可用"}
                </div>
                {!listing.available && listing.reasons.length > 0 ? (
                  <p className="mt-1 text-[11px] leading-5 text-blood">
                    {listing.reasons.join("；")}
                  </p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfirmSwitch({
  currentTitle,
  campaignVersion,
  campaignEvents,
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  currentTitle: string;
  campaignVersion: number;
  campaignEvents: number;
  target: PackListing;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div>
      <p className="leading-6">
        换到《{target.title}》会离开现在这场，不会跟现在的事件写进同一条时间线。现在这场《
        {currentTitle}》会留在库里（状态版本 v{campaignVersion}，事件 {campaignEvents}{" "}
        条）；那边若已有存档就接着玩，没有就从开场白另起。
      </p>
      <p className="mt-2 text-[11px] leading-5 text-muted">
        页面会重新加载，按选中的模组重新装配资料包，避免一半旧一半新。
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded border border-line/70 px-3 transition hover:border-brass/60 hover:text-brass md:min-h-0 md:px-2 md:py-1"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-11 rounded border border-brass/60 px-3 text-brass transition hover:border-brass disabled:opacity-50 md:min-h-0 md:px-2 md:py-1"
        >
          换模组
        </button>
      </div>
    </div>
  );
}
