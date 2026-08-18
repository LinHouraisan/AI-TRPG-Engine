import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { ContextPanel } from "@/components/context-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { getCampaign, listSessions, loadMessages } from "@/lib/db";
import { saveSettings } from "@/lib/settings";

export const Route = createFileRoute(
  "/campaigns/$campaignId/sessions/$sessionId",
)({
  component: SessionPage,
});

function SessionPage() {
  const { campaignId, sessionId } = Route.useParams();
  const navigate = useNavigate();

  const campaign = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => getCampaign(campaignId),
  });

  const sessions = useQuery({
    queryKey: ["sessions", campaignId],
    queryFn: () => listSessions(campaignId),
  });

  const messages = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => loadMessages(sessionId),
    enabled: sessionId !== "latest",
  });

  useEffect(() => {
    if (sessionId !== "latest") {
      void saveSettings({ lastCampaignId: campaignId, lastSessionId: sessionId });
      return;
    }
    const first = sessions.data?.[sessions.data.length - 1] ?? sessions.data?.[0];
    if (first) {
      void navigate({
        to: "/campaigns/$campaignId/sessions/$sessionId",
        params: { campaignId, sessionId: first.id },
        replace: true,
      });
    }
  }, [campaignId, navigate, sessionId, sessions.data]);

  if (sessionId === "latest" || messages.isLoading || campaign.isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize={64} minSize={40}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-center border-b px-4">
            <p className="truncate text-sm font-medium">
              {campaign.data?.name ?? "战役"}
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <ChatPanel
              key={sessionId}
              campaignId={campaignId}
              sessionId={sessionId}
              initialMessages={messages.data ?? []}
            />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={36} minSize={24}>
        <ContextPanel campaignId={campaignId} sessionId={sessionId} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
