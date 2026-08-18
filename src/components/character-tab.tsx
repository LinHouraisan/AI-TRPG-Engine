import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { createCharacter, listCharacters, updateCharacter } from "@/lib/db";
import { useUiStore } from "@/stores/ui";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

const STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

export function CharacterTab({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const selectedId = useUiStore((state) => state.selectedCharacterId);
  const setSelectedId = useUiStore((state) => state.setSelectedCharacterId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ancestry, setAncestry] = useState("");
  const [className, setClassName] = useState("");

  const characters = useQuery({
    queryKey: ["characters", campaignId],
    queryFn: () => listCharacters(campaignId),
  });

  const selected =
    characters.data?.find((character) => character.id === selectedId) ??
    characters.data?.[0] ??
    null;

  const createMutation = useMutation({
    mutationFn: () =>
      createCharacter({ campaignId, name, ancestry, className }),
    onSuccess: async (character) => {
      setSelectedId(character.id);
      setOpen(false);
      setName("");
      setAncestry("");
      setClassName("");
      await queryClient.invalidateQueries({ queryKey: ["characters", campaignId] });
    },
    onError: (error) => toast.error(error.message),
  });

  const patchMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateCharacter>[1]) =>
      updateCharacter(selected!.id, patch),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["characters", campaignId] }),
    onError: (error) => toast.error(error.message),
  });

  if (!characters.data?.length) {
    return (
      <>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有人物卡</EmptyTitle>
            <EmptyDescription>
              先车一张人物卡，之后模型就能在对话里帮你改生命值和背包。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              新建人物卡
            </Button>
          </EmptyContent>
        </Empty>
        <CreateDialog
          open={open}
          onOpenChange={setOpen}
          name={name}
          ancestry={ancestry}
          className={className}
          setName={setName}
          setAncestry={setAncestry}
          setClassName={setClassName}
          pending={createMutation.isPending}
          onCreate={() => createMutation.mutate()}
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-2">
        {characters.data.map((character) => (
          <Button
            key={character.id}
            size="sm"
            variant={character.id === selected?.id ? "default" : "outline"}
            onClick={() => setSelectedId(character.id)}
          >
            {character.name}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          新建
        </Button>
      </div>
      {selected ? (
        <ScrollArea className="min-h-0 flex-1">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{selected.name}</CardTitle>
              <CardDescription>
                {[selected.ancestry, selected.className, `${selected.level} 级`]
                  .filter(Boolean)
                  .join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Field>
                  <FieldLabel htmlFor="hp">生命值</FieldLabel>
                  <Input
                    id="hp"
                    type="number"
                    defaultValue={selected.hp}
                    key={`${selected.id}-hp-${selected.hp}`}
                    onBlur={(event) =>
                      patchMutation.mutate({ hp: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="max-hp">上限</FieldLabel>
                  <Input
                    id="max-hp"
                    type="number"
                    defaultValue={selected.maxHp}
                    key={`${selected.id}-max-${selected.maxHp}`}
                    onBlur={(event) =>
                      patchMutation.mutate({ maxHp: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ac">护甲等级</FieldLabel>
                  <Input
                    id="ac"
                    type="number"
                    defaultValue={selected.ac}
                    key={`${selected.id}-ac-${selected.ac}`}
                    onBlur={(event) =>
                      patchMutation.mutate({ ac: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {STAT_KEYS.map((stat) => (
                  <Field key={stat}>
                    <FieldLabel htmlFor={stat}>{stat.toUpperCase()}</FieldLabel>
                    <Input
                      id={stat}
                      type="number"
                      defaultValue={selected.stats[stat]}
                      key={`${selected.id}-${stat}-${selected.stats[stat]}`}
                      onBlur={(event) =>
                        patchMutation.mutate({
                          stats: {
                            ...selected.stats,
                            [stat]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {selected.conditions.length ? (
                  selected.conditions.map((condition) => (
                    <Badge key={condition} variant="secondary">
                      {condition}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    没有任何状态
                  </span>
                )}
              </div>
              <Separator />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">背包</p>
                {selected.inventory.length ? (
                  selected.inventory.map((item) => (
                    <p key={item.name} className="text-sm text-muted-foreground">
                      {item.name} ×{item.qty}
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">背包是空的</p>
                )}
              </div>
              <Field>
                <FieldLabel htmlFor="char-notes">笔记</FieldLabel>
                <Textarea
                  id="char-notes"
                  defaultValue={selected.notes}
                  key={`${selected.id}-notes-${selected.notes}`}
                  onBlur={(event) =>
                    patchMutation.mutate({ notes: event.target.value })
                  }
                />
              </Field>
            </CardContent>
          </Card>
        </ScrollArea>
      ) : null}
      <CreateDialog
        open={open}
        onOpenChange={setOpen}
        name={name}
        ancestry={ancestry}
        className={className}
        setName={setName}
        setAncestry={setAncestry}
        setClassName={setClassName}
        pending={createMutation.isPending}
        onCreate={() => createMutation.mutate()}
      />
    </div>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  name,
  ancestry,
  className,
  setName,
  setAncestry,
  setClassName,
  pending,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  ancestry: string;
  className: string;
  setName: (value: string) => void;
  setAncestry: (value: string) => void;
  setClassName: (value: string) => void;
  pending: boolean;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建人物卡</DialogTitle>
          <DialogDescription>一张简单的人物卡，模型可以直接改。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-char-name">名称</FieldLabel>
            <Input
              id="new-char-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-char-ancestry">种族</FieldLabel>
            <Input
              id="new-char-ancestry"
              value={ancestry}
              onChange={(event) => setAncestry(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-char-class">职业</FieldLabel>
            <Input
              id="new-char-class"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onCreate} disabled={pending || !name.trim()}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
