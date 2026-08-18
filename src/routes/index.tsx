import { useEffect } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DicesIcon } from "lucide-react";
import { listCampaigns, listSessions } from "@/lib/db";
import { loadSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: listCampaigns,
  });

  useEffect(() => {
    void (async () => {
      const settings = await loadSettings();
      if (settings.lastCampaignId && settings.lastSessionId) {
        await navigate({
          to: "/campaigns/$campaignId/sessions/$sessionId",
          params: {
            campaignId: settings.lastCampaignId,
            sessionId: settings.lastSessionId,
          },
        });
        return;
      }
      const first = campaigns.data?.[0];
      if (!first) return;
      const sessions = await listSessions(first.id);
      if (sessions[0]) {
        await navigate({
          to: "/campaigns/$campaignId/sessions/$sessionId",
          params: { campaignId: first.id, sessionId: sessions[0].id },
        });
      }
    })();
  }, [campaigns.data, navigate]);

  if (campaigns.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <Empty className="h-full border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DicesIcon />
        </EmptyMedia>
        <EmptyTitle>开一个新战役</EmptyTitle>
        <EmptyDescription>
          和本地或云端的模型一起跑团。人物卡、战斗记录和 SRD 资料都只存在你自己的硬盘上。
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/settings" />} nativeButton={false}>
          打开设置
        </Button>
      </EmptyContent>
    </Empty>
  );
}
