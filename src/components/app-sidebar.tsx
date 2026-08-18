import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { DicesIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { createCampaign, createSession, listCampaigns, listSessions } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as {
    campaignId?: string;
    sessionId?: string;
  };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [premise, setPremise] = useState("");

  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: listCampaigns,
  });

  const sessions = useQuery({
    queryKey: ["sessions", params.campaignId],
    queryFn: () => listSessions(params.campaignId!),
    enabled: Boolean(params.campaignId),
  });

  const createCampaignMutation = useMutation({
    mutationFn: () => createCampaign({ name, premise }),
    onSuccess: async ({ campaign, session }) => {
      await saveSettings({
        lastCampaignId: campaign.id,
        lastSessionId: session.id,
      });
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setOpen(false);
      setName("");
      setPremise("");
      await navigate({
        to: "/campaigns/$campaignId/sessions/$sessionId",
        params: { campaignId: campaign.id, sessionId: session.id },
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const createSessionMutation = useMutation({
    mutationFn: () => createSession(params.campaignId!),
    onSuccess: async (session) => {
      await saveSettings({
        lastCampaignId: session.campaignId,
        lastSessionId: session.id,
      });
      await queryClient.invalidateQueries({
        queryKey: ["sessions", session.campaignId],
      });
      await navigate({
        to: "/campaigns/$campaignId/sessions/$sessionId",
        params: { campaignId: session.campaignId, sessionId: session.id },
      });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                render={<Link to="/" />}
                tooltip="AI TRPG Engine"
              >
                <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <DicesIcon />
                </div>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-medium">AI TRPG Engine</span>
                  <span className="truncate text-xs text-muted-foreground">
                    本地跑团桌
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>战役</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {(campaigns.data ?? []).map((campaign) => (
                  <SidebarMenuItem key={campaign.id}>
                    <SidebarMenuButton
                      isActive={params.campaignId === campaign.id}
                      tooltip={campaign.name}
                      render={
                        <Link
                          to="/campaigns/$campaignId/sessions/$sessionId"
                          params={{
                            campaignId: campaign.id,
                            sessionId:
                              params.campaignId === campaign.id && params.sessionId
                                ? params.sessionId
                                : "latest",
                          }}
                        />
                      }
                    >
                      <span className="truncate">{campaign.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {params.campaignId ? (
            <SidebarGroup>
              <SidebarGroupLabel>聚会</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {(sessions.data ?? []).map((session) => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={params.sessionId === session.id}
                        tooltip={session.title}
                        render={
                          <Link
                            to="/campaigns/$campaignId/sessions/$sessionId"
                            params={{
                              campaignId: session.campaignId,
                              sessionId: session.id,
                            }}
                          />
                        }
                      >
                        <span className="truncate">{session.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => createSessionMutation.mutate()}
                      disabled={createSessionMutation.isPending}
                    >
                      <PlusIcon data-icon="inline-start" />
                      新开一场
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                新建战役
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/settings" />}
                isActive={false}
                tooltip="设置"
              >
                <SettingsIcon data-icon="inline-start" />
                设置
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建战役</DialogTitle>
            <DialogDescription>
              一个战役相当于一本活页夹，里面每一场聚会都是一条独立的对话。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="campaign-name">名称</FieldLabel>
              <Input
                id="campaign-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="余烬之路"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="campaign-premise">开场设定</FieldLabel>
              <Textarea
                id="campaign-premise"
                value={premise}
                onChange={(event) => setPremise(event.target.value)}
                placeholder="一座边境小镇，一支失踪的商队，一个沉默的教团。"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => createCampaignMutation.mutate()}
              disabled={createCampaignMutation.isPending}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
