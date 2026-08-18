import { useEffect, useRef } from "react";
import type { Message } from "@/session";
import { CheckCard } from "./CheckCard";

export function NarrationColumn({ messages }: { messages: Message[] }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {messages.map((message) => {
          if (message.role === "pl") {
            return (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[80%] rounded-xl rounded-br-sm bg-ink-3 px-3 py-2 text-sm">
                  {message.text}
                </p>
              </div>
            );
          }
          if (message.role === "system") {
            return (
              <p key={message.id} className="text-center text-xs text-muted">
                {message.text}
              </p>
            );
          }
          return (
            <div key={message.id}>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[11px] tracking-widest text-brass">守秘人</span>
                <span className="text-[11px] text-muted">状态版本 v{message.stateVersion}</span>
              </div>
              <div className="font-serif text-[15px] leading-7 whitespace-pre-line text-paper/95">
                {message.text}
              </div>
              {message.check ? <CheckCard check={message.check} /> : null}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
    </div>
  );
}
