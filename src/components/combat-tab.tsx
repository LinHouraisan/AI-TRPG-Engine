import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addCombatant,
  endCombat,
  getActiveEncounter,
  startCombat,
  updateCombatant,
} from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CombatTab({
  campaignId,
  sessionId,
}: {
  campaignId: string;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const combat = useQuery({
    queryKey: ["combat", campaignId],
    queryFn: () => getActiveEncounter(campaignId),
  });

  const startMutation = useMutation({
    mutationFn: () => startCombat({ campaignId, sessionId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["combat", campaignId] }),
    onError: (error) => toast.error(error.message),
  });

  const endMutation = useMutation({
    mutationFn: () => endCombat(campaignId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["combat", campaignId] }),
    onError: (error) => toast.error(error.message),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      addCombatant({
        encounterId: combat.data!.encounter.id,
        name: "敌人",
        hp: 10,
        ac: 12,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["combat", campaignId] }),
    onError: (error) => toast.error(error.message),
  });

  if (!combat.data) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>暂无战斗</EmptyTitle>
          <EmptyDescription>
            你可以在这里直接开战，也可以让模型来掷先攻。
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
          >
            开始战斗
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const ordered = [...combat.data.combatants].sort((a, b) => {
    const ai = a.initiative ?? -999;
    const bi = b.initiative ?? -999;
    if (bi !== ai) return bi - ai;
    return a.sortOrder - b.sortOrder;
  });

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{combat.data.encounter.name}</CardTitle>
            <CardDescription>按先攻从高到低排列</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending}
            >
              添加参战者
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => endMutation.mutate()}
              disabled={endMutation.isPending}
            >
              结束
            </Button>
          </CardContent>
        </Card>
        {ordered.map((combatant) => (
          <Card key={combatant.id} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="truncate">{combatant.name}</span>
                {combatant.isPlayer ? <Badge variant="secondary">PC</Badge> : null}
              </CardTitle>
              <CardDescription>护甲等级 {combatant.ac}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                生命值
                <Input
                  type="number"
                  defaultValue={combatant.hp}
                  key={`${combatant.id}-hp-${combatant.hp}`}
                  onBlur={(event) =>
                    updateCombatant(combatant.id, {
                      hp: Number(event.target.value),
                    }).then(() =>
                      queryClient.invalidateQueries({
                        queryKey: ["combat", campaignId],
                      }),
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                先攻
                <Input
                  type="number"
                  defaultValue={combatant.initiative ?? ""}
                  key={`${combatant.id}-init-${combatant.initiative}`}
                  onBlur={(event) =>
                    updateCombatant(combatant.id, {
                      initiative: event.target.value
                        ? Number(event.target.value)
                        : null,
                    }).then(() =>
                      queryClient.invalidateQueries({
                        queryKey: ["combat", campaignId],
                      }),
                    )
                  }
                />
              </label>
              <div className="col-span-2 flex flex-wrap gap-1">
                {combatant.conditions.map((condition) => (
                  <Badge key={condition} variant="secondary">
                    {condition}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
