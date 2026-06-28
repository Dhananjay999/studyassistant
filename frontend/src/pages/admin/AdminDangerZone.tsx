// Global, platform-wide destructive actions. Every action requires typing a
// confirmation word and hits a server endpoint that re-verifies admin auth.

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useDeleteAll } from "@/hooks/adminApi";
import type { GlobalResource } from "@/types/admin";

const ACTIONS: { resource: GlobalResource; label: string; desc: string }[] = [
  {
    resource: "files",
    label: "Delete all files",
    desc: "Every uploaded file and its storage object, for all users.",
  },
  {
    resource: "bookmarks",
    label: "Delete all bookmarks",
    desc: "Every bookmark across all users.",
  },
  {
    resource: "flashcards",
    label: "Delete all flashcards",
    desc: "Every flashcard set across all users.",
  },
  {
    resource: "quizzes",
    label: "Delete all quizzes",
    desc: "Every quiz across all users.",
  },
  {
    resource: "sessions",
    label: "Delete all chats & sessions",
    desc: "Every session and message across all users.",
  },
  {
    resource: "users",
    label: "Delete ALL users",
    desc: "Every user and ALL of their data. The platform will be empty.",
  },
];

export function AdminDangerZone() {
  const deleteAll = useDeleteAll();
  const [pending, setPending] = useState<GlobalResource | null>(null);

  const active = ACTIONS.find((a) => a.resource === pending) ?? null;

  const run = async () => {
    if (!pending) return;
    try {
      await deleteAll.mutateAsync(pending);
      toast.success(`Deleted all ${pending}`);
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <h1 className="text-xl font-semibold tracking-tight">Danger zone</h1>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p>
          These actions are global and irreversible. They affect every user on
          the platform. Each requires typing a confirmation word.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ACTIONS.map((a) => (
          <Card key={a.resource} className="border-destructive/20">
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{a.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.desc}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => setPending(a.resource)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {active && (
        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(o) => !o && setPending(null)}
          title={active.label + "?"}
          description={`${active.desc} This CANNOT be undone.`}
          confirmText={active.label}
          confirmWord="DELETE"
          loading={deleteAll.isPending}
          onConfirm={run}
        />
      )}
    </div>
  );
}
