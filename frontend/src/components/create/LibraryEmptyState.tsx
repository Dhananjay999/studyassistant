import { Link } from "react-router-dom";
import { Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Empty library (Quizzes / Flashcards): explains the feature and opens the
 * page's creation panel directly, with Chat offered as the other way in.
 */
export function LibraryEmptyState({
  icon: Icon,
  title,
  body,
  cta,
  onCreate,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  onCreate: () => void;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 px-4 py-20 text-center">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      <Button variant="brand" className="mt-5 gap-2" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        {cta}
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        or just ask Aeva in{" "}
        <Link to="/chat" className="font-medium text-primary underline">
          Chat
        </Link>
      </p>
    </div>
  );
}
