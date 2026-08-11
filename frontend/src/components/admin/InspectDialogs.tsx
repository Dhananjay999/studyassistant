// Deep-inspection dialogs for the admin user console: full quiz (config,
// questions with answers, attempt history), flashcard deck (cards + study
// state), media processing state, and the audited profile editor. All
// read from dedicated admin endpoints; nothing here touches student UI.

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAdminFlashcardDetail,
  useAdminMediaDetail,
  useAdminQuizDetail,
  useEditProfile,
} from "@/hooks/adminApi";
import { formatBytes, formatDate, formatDateTime } from "@/lib/adminFormat";
import { formatDuration } from "@/lib/quizFormat";
import { cn } from "@/lib/utils";
import type {
  AdminEditProfileInput,
  AdminQuizAttempt,
  AdminUserProfile,
} from "@/types/admin";

function Shell({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent className="max-h-[85vh] sm:max-w-2xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="truncate pr-6">
            {title}
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <ResponsiveModalBody>{children}</ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

/* ------------------------------- Quiz ---------------------------------- */

function AttemptRow({
  attempt,
  index,
  questionPrompts,
}: {
  attempt: AdminQuizAttempt;
  index: number;
  questionPrompts: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ev = (attempt.evaluation ?? {}) as Record<string, unknown>;
  const perQuestion =
    (ev.per_question as Array<Record<string, unknown>>) ?? [];
  const seconds = Number(ev.time_taken_seconds ?? 0);
  const hasAnalysis = Boolean(
    (attempt.feedback as Record<string, unknown> | null)?.study_plan,
  );

  return (
    <div className="rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
      >
        <span className="font-medium">Attempt {index + 1}</span>
        <Badge variant="secondary">
          {Math.round(Number(attempt.score ?? 0))}%
        </Badge>
        <span className="text-xs text-muted-foreground">
          {String(ev.correct_count ?? "?")}/{String(ev.total ?? "?")} correct
        </span>
        {seconds > 0 && (
          <span className="text-xs text-muted-foreground">
            {formatDuration(seconds)}
          </span>
        )}
        {hasAnalysis && (
          <Badge variant="outline" className="text-[10px]">
            AI analysis
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDateTime(attempt.created_at)}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/50 p-3">
          {perQuestion.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No per-question breakdown stored.
            </p>
          )}
          {perQuestion.map((row, i) => {
            const correct = Boolean(row.is_correct);
            const userAns =
              (row.user_answer as string[])?.join(", ") || "— unanswered";
            return (
              <div key={i} className="rounded-md bg-muted/30 px-2.5 py-1.5">
                <p className="text-xs font-medium">
                  {i + 1}.{" "}
                  {questionPrompts.get(String(row.question_id)) ??
                    String(row.question_id)}
                </p>
                <p
                  className={cn(
                    "mt-0.5 flex items-center gap-1 text-[11px]",
                    correct
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400",
                  )}
                >
                  {correct ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                  {userAns}
                </p>
                {!correct && (
                  <p className="text-[11px] text-muted-foreground">
                    Correct: {(row.correct_answer as string[])?.join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function QuizDetailDialog({
  quizId,
  onClose,
}: {
  quizId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useAdminQuizDetail(quizId);
  const prompts = new Map(
    (data?.questions ?? []).map((q) => [q.id, q.prompt]),
  );
  return (
    <Shell
      open={quizId !== null}
      title={data?.quiz.title ?? "Quiz"}
      onClose={onClose}
    >
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Topic" value={data.quiz.topic} />
            <Field label="Difficulty" value={data.quiz.difficulty} />
            <Field label="Questions" value={data.questions.length} />
            <Field
              label="Exam pattern"
              value={
                (data.quiz.exam_config as Record<string, unknown>)?.pattern as
                  | string
                  | undefined
              }
            />
            <Field label="Created" value={formatDate(data.quiz.created_at)} />
            <Field label="Attempts" value={data.attempts.length} />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Questions
            </p>
            <div className="space-y-2.5">
              {data.questions.map((q, i) => (
                <div key={q.id} className="rounded-lg border border-border/60 p-3">
                  <p className="text-sm font-medium">
                    {i + 1}. {q.prompt}
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {q.options.map((opt) => {
                      const correct = q.correct_answers.includes(opt);
                      return (
                        <p
                          key={opt}
                          className={cn(
                            "rounded px-2 py-0.5 text-xs",
                            correct
                              ? "bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {correct ? "✓ " : ""}
                          {opt}
                        </p>
                      );
                    })}
                  </div>
                  {q.explanation && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Why: {q.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Attempt history
            </p>
            {data.attempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attempts yet.</p>
            ) : (
              <div className="space-y-2">
                {[...data.attempts].reverse().map((a, i) => (
                  <AttemptRow
                    key={a.id}
                    attempt={a}
                    index={i}
                    questionPrompts={prompts}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ----------------------------- Flashcards ------------------------------ */

export function FlashcardDetailDialog({
  setId,
  onClose,
}: {
  setId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useAdminFlashcardDetail(setId);
  return (
    <Shell
      open={setId !== null}
      title={data?.set.title ?? "Flashcards"}
      onClose={onClose}
    >
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Topic" value={data.set.topic} />
            <Field label="Cards" value={data.cards.length} />
            <Field label="Source" value={data.set.source_type as string} />
            <Field label="Created" value={formatDate(data.set.created_at)} />
          </div>
          <div className="space-y-2">
            {data.cards.map((c, i) => (
              <div key={c.id} className="rounded-lg border border-border/60 p-3">
                <p className="text-sm font-medium">
                  {i + 1}. {c.front}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{c.back}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {c.study ? (
                    <>
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {c.study.rating.replace("_", " ")}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        reviewed {formatDate(c.study.updated_at)}
                      </span>
                    </>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      never reviewed
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

/* -------------------------------- Media -------------------------------- */

export function MediaDetailDialog({
  mediaId,
  onClose,
}: {
  mediaId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useAdminMediaDetail(mediaId);
  return (
    <Shell
      open={mediaId !== null}
      title={data?.file_name ?? "Media"}
      onClose={onClose}
    >
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Type" value={data.mime_type} />
            <Field label="Size" value={formatBytes(data.size_bytes)} />
            <Field label="Uploaded" value={formatDateTime(data.created_at)} />
            <Field
              label="Processing"
              value={
                <Badge
                  variant={
                    data.processing_status === "failed"
                      ? "destructive"
                      : "secondary"
                  }
                  className="capitalize"
                >
                  {data.processing_status || "n/a"}
                </Badge>
              }
            />
            <Field
              label="Pages parsed"
              value={
                data.page_count != null
                  ? `${data.parsed_pages}/${data.page_count}`
                  : data.parsed_pages || undefined
              }
            />
            <Field
              label="Chunks embedded"
              value={`${data.embedded_chunks}${
                data.chunk_count ? `/${data.chunk_count}` : ""
              }`}
            />
          </div>
          {typeof data.processing_error === "string" &&
            data.processing_error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-xs font-semibold text-destructive">
                  Processing error
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
                  {data.processing_error}
                </p>
              </div>
            )}
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={data.signed_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Open original
            </a>
          </Button>
        </div>
      )}
    </Shell>
  );
}

/* --------------------------- Profile editor ---------------------------- */

const PROFILE_FIELDS: Array<{
  key: keyof AdminEditProfileInput;
  label: string;
}> = [
  { key: "full_name", label: "Name" },
  { key: "education_level", label: "Class / Education level" },
  { key: "learning_goal", label: "Exam / Learning goal" },
  { key: "preferred_language", label: "Preferred language" },
  { key: "explanation_style", label: "Explanation style" },
  { key: "ai_personality", label: "AI personality" },
  { key: "communication_style", label: "Communication style" },
];

export function ProfileEditDialog({
  userId,
  profile,
  open,
  onClose,
}: {
  userId: string;
  profile: AdminUserProfile;
  open: boolean;
  onClose: () => void;
}) {
  const edit = useEditProfile();
  const [values, setValues] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState("");
  const [instructions, setInstructions] = useState("");

  // Re-seed the form each time it opens.
  useEffect(() => {
    if (!open) return;
    const learning = profile.learning_profile;
    setValues({
      full_name: profile.full_name ?? "",
      education_level: learning.education_level ?? "",
      learning_goal: learning.learning_goal ?? "",
      preferred_language: learning.preferred_language ?? "",
      explanation_style: learning.explanation_style ?? "",
      ai_personality: (learning.ai_personality as string | null) ?? "",
      communication_style:
        (learning.communication_style as string | null) ?? "",
    });
    setSubjects(learning.favorite_subjects.join(", "));
    setInstructions(
      (learning.custom_instructions as string | null) ?? "",
    );
  }, [open, profile]);

  const save = () => {
    const patch: AdminEditProfileInput = {};
    for (const { key } of PROFILE_FIELDS) {
      patch[key] = (values[key]?.trim() || null) as never;
    }
    patch.custom_instructions = instructions.trim() || null;
    patch.favorite_subjects = subjects
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    edit.mutate(
      { id: userId, patch },
      {
        onSuccess: () => {
          toast.success("Profile updated (audited)");
          onClose();
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Couldn't save changes",
          ),
      },
    );
  };

  return (
    <Shell open={open} title="Edit profile" onClose={onClose}>
      <div className="space-y-3">
        {PROFILE_FIELDS.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`pf-${key}`} className="text-xs">
              {label}
            </Label>
            <Input
              id={`pf-${key}`}
              value={values[key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [key]: e.target.value }))
              }
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="pf-subjects" className="text-xs">
            Favorite subjects (comma-separated)
          </Label>
          <Input
            id="pf-subjects"
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
            placeholder="Physics, Biology"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pf-instructions" className="text-xs">
            Custom instructions
          </Label>
          <Textarea
            id="pf-instructions"
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Email and identity fields aren't editable. Every save is recorded
          in the audit log.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={edit.isPending} className="gap-1.5">
            {edit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </Shell>
  );
}
