import { MapIcon } from "lucide-react";
import { CharacterTab } from "@/components/character-tab";
import { CombatTab } from "@/components/combat-tab";
import { NotesTab } from "@/components/notes-tab";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ContextPanel({
  campaignId,
  sessionId,
}: {
  campaignId: string;
  sessionId: string;
}) {
  return (
    <Tabs defaultValue="character" className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <TabsList>
          <TabsTrigger value="character">人物卡</TabsTrigger>
          <TabsTrigger value="combat">战斗</TabsTrigger>
          <TabsTrigger value="notes">笔记</TabsTrigger>
          <TabsTrigger value="map">地图</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="character" className="min-h-0 flex-1 overflow-hidden">
        <CharacterTab campaignId={campaignId} />
      </TabsContent>
      <TabsContent value="combat" className="min-h-0 flex-1 overflow-hidden">
        <CombatTab campaignId={campaignId} sessionId={sessionId} />
      </TabsContent>
      <TabsContent value="notes" className="min-h-0 flex-1 overflow-hidden">
        <NotesTab campaignId={campaignId} sessionId={sessionId} />
      </TabsContent>
      <TabsContent value="map" className="min-h-0 flex-1 overflow-hidden">
        <Empty className="h-full border-none">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapIcon />
            </EmptyMedia>
            <EmptyTitle>地图以后再说</EmptyTitle>
            <EmptyDescription>
              棋子地图不在 v1 的范围里，我们先把对话和战斗做好。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TabsContent>
    </Tabs>
  );
}
