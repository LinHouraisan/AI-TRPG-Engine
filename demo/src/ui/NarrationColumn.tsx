import { useEffect, useRef } from "react";
import type { Message } from "@/session";
import { CheckCard, PendingCheckNote } from "./CheckCard";
import type { WaitLine } from "./pending";

export function NarrationColumn({
  messages,
  wait,
  draft,
}: {
  messages: Message[];
  wait: WaitLine | null;
  /** 还没过体检的叙述。绝不能写进 messages。 */
  draft: string | null;
}) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: draft ? "auto" : "smooth" });
  }, [messages, wait, draft]);

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {messages.map((message) => {
          if (message.role === "pl") {
            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[80%]">
                  <div className="mb-0.5 text-right text-[10px] tracking-widest text-muted">
                    调查员
                  </div>
                  <p className="rounded-xl rounded-br-sm bg-ink-3 px-3 py-2 text-sm break-words">
                    {message.text}
                  </p>
                </div>
              </div>
            );
          }
          if (message.role === "system") {
            return (
              <div
                key={message.id}
                className="mx-auto w-full max-w-md rounded-md border border-dashed border-line/70 bg-ink-3/35 px-3 py-2 text-center"
              >
                <div className="mb-0.5 text-[10px] tracking-widest text-muted/80">系统</div>
                <p className="text-[12px] leading-5 break-words text-muted">{message.text}</p>
              </div>
            );
          }
          return (
            <div key={message.id} className="border-l-2 border-brass/45 pl-3">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[11px] tracking-widest text-brass">守秘人</span>
                <span className="text-[11px] text-muted">状态版本 v{message.stateVersion}</span>
                {message.source ? (
                  <span
                    title={message.note ?? undefined}
                    className="text-[10px] text-muted/55"
                  >
                    {message.source}
                    {message.note ? " ·" : ""}
                  </span>
                ) : null}
              </div>
              <div className="font-serif text-[15px] leading-7 whitespace-pre-line break-words text-paper/95">
                {message.text}
              </div>
              {message.check ? <CheckCard check={message.check} /> : null}
            </div>
          );
        })}
        {wait ? (
          <div className="rounded-md border border-line/50 bg-ink-3/30 px-3 py-2">
            <p className="flex items-start gap-2 text-xs text-paper/80">
              <span className="mt-1.5 inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-brass" />
              <span className="break-words">{wait.primary}</span>
            </p>
            {wait.detail ? (
              <p className="mt-1 pl-3.5 text-[11px] text-muted">{wait.detail}</p>
            ) : null}
            {wait.check ? (
              <div className="pl-3.5">
                <PendingCheckNote check={wait.check} />
              </div>
            ) : null}
          </div>
        ) : null}
        {draft ? <DraftNarration text={draft} /> : null}
        <div ref={bottom} />
      </div>
    </div>
  );
}

/** 虚线、淡字、斜体：跟左边那条黄铜竖线的定稿一眼能分开。 */
function DraftNarration({ text }: { text: string }) {
  return (
    <div className="border-l-2 border-dashed border-muted/45 bg-ink-3/25 py-1 pl-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] tracking-widest text-muted">守秘人</span>
        <span className="rounded border border-dashed border-muted/55 px-1.5 py-px text-[10px] text-muted">
          未定稿
        </span>
        <span className="text-[10px] text-muted/70">还没作数，可能被收回</span>
      </div>
      <div className="font-serif text-[15px] leading-7 whitespace-pre-line break-words text-muted italic">
        {text}
        <span
          className="ml-0.5 inline-block h-[1em] w-[0.45ch] animate-pulse bg-muted/70 align-[-0.1em]"
          aria-hidden
        />
      </div>
    </div>
  );
}
