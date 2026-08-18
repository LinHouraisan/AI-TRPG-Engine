import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { isToolUIPart, type UIMessage } from "ai";
import { ArrowUpIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { saveMessages } from "@/lib/db";
import { createGameTransport } from "@/lib/transport";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { CheckCard } from "@/components/check-card";
import { cn } from "@/lib/utils";

function toolLabel(part: UIMessage["parts"][number]): string {
  if (!isToolUIPart(part)) return "";
  const name = part.type.replace(/^tool-/, "");
  if (part.state === "output-error") return `${name} 失败`;
  if (part.state !== "output-available") return `${name}…`;
  if (name === "check" && part.output && typeof part.output === "object") {
    const output = part.output as { detail?: string; error?: string };
    return output.error ?? output.detail ?? "检定";
  }
  if (name === "roll_dice" && part.output && typeof part.output === "object") {
    const output = part.output as { detail?: string; total?: number };
    return output.detail ?? `掷出 ${output.total ?? ""}`;
  }
  return name.replace(/_/g, " ");
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <div className="flex flex-col gap-2">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return isUser ? (
                <p key={index} className="whitespace-pre-wrap">
                  {part.text}
                </p>
              ) : (
                <div key={index} className="chat-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {part.text}
                  </ReactMarkdown>
                </div>
              );
            }
            if (isToolUIPart(part)) {
              const name = part.type.replace(/^tool-/, "");
              if (name === "check" && part.state === "output-available") {
                return (
                  <div key={index} className="space-y-1">
                    <CheckCard output={part.output} />
                  </div>
                );
              }
              return (
                <Badge key={index} variant="secondary">
                  {toolLabel(part)}
                </Badge>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({
  campaignId,
  sessionId,
  initialMessages,
}: {
  campaignId: string;
  sessionId: string;
  initialMessages: UIMessage[];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () => createGameTransport({ campaignId, sessionId, queryClient }),
    [campaignId, sessionId, queryClient],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport,
    onFinish: ({ messages: next }) => {
      void saveMessages(sessionId, next);
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await sendMessage({ text });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-4">
          {messages.length === 0 ? (
            <Empty className="border-none">
              <EmptyHeader>
                <EmptyTitle>桌上还没人开口</EmptyTitle>
                <EmptyDescription>
                  说说你们这队人打算做什么。模型可以帮你掷骰、查阅 SRD
                  规则，也能顺手更新人物卡。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}
          {error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <form onSubmit={onSubmit} className="border-t p-3">
        <InputGroup className="h-auto">
          <InputGroupTextarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="你打算做什么？"
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSubmit(event);
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            {busy ? (
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => stop()}>
                <Spinner />
              </Button>
            ) : (
              <InputGroupButton type="submit" size="icon-xs" disabled={!draft.trim()}>
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
