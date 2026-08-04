// Create / edit dialog for a Study Space: name, subject, description, and a
// color + icon identity picker. Used by the Spaces page and the sidebar.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SPACE_COLOR_KEYS,
  SPACE_ICON_KEYS,
  spaceColor,
  spaceIcon,
} from "@/lib/spaces";
import { cn } from "@/lib/utils";

export interface SpaceFormValues {
  name: string;
  subject: string;
  description: string;
  color: string;
  icon: string;
}

const EMPTY: SpaceFormValues = {
  name: "",
  subject: "",
  description: "",
  color: "brand",
  icon: "book",
};

export function SpaceDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  busy = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  /** Pre-filled values (edit / convert); omitted fields fall back to blank. */
  initial?: Partial<SpaceFormValues>;
  busy?: boolean;
  onSubmit: (values: SpaceFormValues) => void;
}) {
  const [values, setValues] = useState<SpaceFormValues>(EMPTY);

  // Re-seed the form each time the dialog opens (fresh create or new target).
  useEffect(() => {
    if (open) setValues({ ...EMPTY, ...initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (p: Partial<SpaceFormValues>) =>
    setValues((v) => ({ ...v, ...p }));
  const canSubmit = values.name.trim().length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            A Study Space keeps everything about one subject — chats, files,
            quizzes, flashcards — together.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="space-name">Name</Label>
            <Input
              id="space-name"
              value={values.name}
              maxLength={80}
              placeholder="e.g. Operating Systems"
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="space-subject">Subject (optional)</Label>
            <Input
              id="space-subject"
              value={values.subject}
              maxLength={80}
              placeholder="e.g. Computer Science"
              onChange={(e) => patch({ subject: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="space-description">Description (optional)</Label>
            <Textarea
              id="space-description"
              value={values.description}
              maxLength={500}
              rows={2}
              placeholder="What are you studying here? Aeva uses this as context."
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {SPACE_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Color ${key}`}
                  onClick={() => patch({ color: key })}
                  className={cn(
                    "h-7 w-7 rounded-full transition-transform hover:scale-110",
                    spaceColor(key).dot,
                    values.color === key &&
                      "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
              {SPACE_ICON_KEYS.map((key) => {
                const Icon = spaceIcon(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`Icon ${key}`}
                    onClick={() => patch({ icon: key })}
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-lg border transition-colors",
                      values.icon === key
                        ? cn(
                            spaceColor(values.color).tint,
                            spaceColor(values.color).ring,
                            spaceColor(values.color).text,
                          )
                        : "border-border/60 text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!canSubmit}
            onClick={() => onSubmit({ ...values, name: values.name.trim() })}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
