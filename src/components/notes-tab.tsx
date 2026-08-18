import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createNote, listNotes } from "@/lib/db";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

export function NotesTab({
  campaignId,
  sessionId,
}: {
  campaignId: string;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const notes = useQuery({
    queryKey: ["notes", campaignId],
    queryFn: () => listNotes(campaignId),
  });

  const createMutation = useMutation({
    mutationFn: () => createNote({ campaignId, sessionId, title, body }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      await queryClient.invalidateQueries({ queryKey: ["notes", campaignId] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>新建笔记</CardTitle>
            <CardDescription>钉在这里的关键信息，模型随时可以取用</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="note-title">标题</FieldLabel>
                <Input
                  id="note-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="note-body">内容</FieldLabel>
                <Textarea
                  id="note-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </Field>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !body.trim()}
              >
                保存笔记
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
        {(notes.data ?? []).length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>还没有笔记</EmptyTitle>
              <EmptyDescription>
                你可以自己写一条，也可以让模型帮你存一份战报。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        ) : (
          (notes.data ?? []).map((note) => (
            <Card key={note.id} size="sm">
              <CardHeader>
                <CardTitle>{note.title}</CardTitle>
                <CardDescription>
                  {new Date(note.createdAt).toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {note.body}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
