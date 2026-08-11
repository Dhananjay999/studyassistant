import { useEffect, useMemo, useState } from "react";
import { CircleSlash, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChipSelect } from "@/components/learning/ChipSelect";
import { OnboardingFlow } from "@/components/learning/OnboardingFlow";
import { SettingsField } from "@/components/settings/primitives";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useLearningProfile, useSaveLearningProfile } from "@/hooks/api";
import { cn } from "@/lib/utils";
import {
  AI_PERSONALITIES,
  COMMUNICATION_STYLES,
  CUSTOM_INSTRUCTION_EXAMPLES,
  EDUCATION_LEVELS,
  EXAM_TARGETS,
  EXPLANATION_STYLES,
  FAVORITE_SUBJECTS,
  LEARNING_GOALS,
  LEARNING_TRAIT_OPTIONS,
  PREFERRED_DEPTHS,
  PREFERRED_LANGUAGES,
} from "@/lib/learningProfile";
import type { LearningProfile, LearningProfileInput } from "@/types";

const CUSTOM_MAX = 1000;

const OTHER = "Other";

interface Draft {
  level: string;
  otherLevel: string;
  language: string;
  style: string;
  subjects: string[];
  goal: string;
  personality: string;
  commStyle: string;
  instructions: string;
  examTarget: string;
  traits: string[];
  depth: string;
}

const EMPTY: Draft = {
  level: "",
  otherLevel: "",
  language: "",
  style: "",
  subjects: [],
  goal: "",
  personality: "",
  commStyle: "",
  instructions: "",
  examTarget: "",
  traits: [],
  depth: "",
};

/** Seed editable draft state from a saved profile row. */
function toDraft(profile: LearningProfile | undefined): Draft {
  if (!profile) return EMPTY;
  const saved = profile.education_level ?? "";
  const known = (EDUCATION_LEVELS as readonly string[]).includes(saved);
  return {
    level: saved ? (known ? saved : OTHER) : "",
    otherLevel: saved && !known ? saved : "",
    language: profile.preferred_language ?? "",
    style: profile.explanation_style ?? "",
    subjects: profile.favorite_subjects ?? [],
    goal: profile.learning_goal ?? "",
    personality: profile.ai_personality ?? "",
    commStyle: profile.communication_style ?? "",
    instructions: profile.custom_instructions ?? "",
    examTarget: profile.exam_target ?? "",
    traits: LEARNING_TRAIT_OPTIONS.filter(
      (t) => profile.learning_traits?.[t.key] === true,
    ).map((t) => t.key),
    depth:
      typeof profile.learning_traits?.preferred_depth === "string"
        ? profile.learning_traits.preferred_depth
        : "",
  };
}

function toInput(draft: Draft): LearningProfileInput {
  const resolvedLevel =
    draft.level === OTHER ? draft.otherLevel.trim() : draft.level;
  const traits: Record<string, boolean | string> = {};
  for (const t of LEARNING_TRAIT_OPTIONS) {
    if (draft.traits.includes(t.key)) traits[t.key] = true;
  }
  if (draft.depth) traits.preferred_depth = draft.depth;
  return {
    education_level: resolvedLevel || null,
    preferred_language: draft.language || null,
    explanation_style: draft.style || null,
    favorite_subjects: draft.subjects,
    learning_goal: draft.goal || null,
    ai_personality: draft.personality || null,
    communication_style: draft.commStyle || null,
    custom_instructions: draft.instructions.trim() || null,
    exam_target: draft.examTarget || null,
    learning_traits: traits,
  };
}

/** True when at least one field carries a value (drives the status badge). */
function hasAnyValue(input: LearningProfileInput): boolean {
  return Boolean(
    input.education_level ||
      input.preferred_language ||
      input.explanation_style ||
      input.learning_goal ||
      input.ai_personality ||
      input.communication_style ||
      input.custom_instructions ||
      input.exam_target ||
      (input.learning_traits &&
        Object.keys(input.learning_traits).length > 0) ||
      (input.favorite_subjects && input.favorite_subjects.length > 0),
  );
}

/** Learning Profile — view summary + edit form with save-when-dirty + reset. */
export function LearningProfileSection() {
  const { refreshUser } = useAuth();
  const { setDirty } = useSettings();
  const { data: profile, isLoading } = useLearningProfile();
  const saveMutation = useSaveLearningProfile();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Step-based guided editing (same experience as first-run onboarding).
  const [guidedOpen, setGuidedOpen] = useState(false);

  const saved = useMemo(() => toDraft(profile), [profile]);

  // Re-seed the draft whenever the saved profile loads/changes (unless the user
  // is mid-edit, so we never clobber unsaved work on a background refetch).
  useEffect(() => {
    if (!editing) setDraft(saved);
  }, [saved, editing]);

  const configured =
    profile?.personalization_status === "completed" &&
    hasAnyValue(toInput(saved));

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  // Surface unsaved edits to the shell's discard-guard.
  useEffect(() => {
    setDirty(editing && dirty);
    return () => setDirty(false);
  }, [editing, dirty, setDirty]);

  const single = (key: keyof Draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: d[key] === value ? "" : value }));

  const toggleSubject = (subject: string) =>
    setDraft((d) => ({
      ...d,
      subjects: d.subjects.includes(subject)
        ? d.subjects.filter((s) => s !== subject)
        : [...d.subjects, subject],
    }));

  const toggleTrait = (label: string) => {
    const key = LEARNING_TRAIT_OPTIONS.find((t) => t.label === label)?.key;
    if (!key) return;
    setDraft((d) => ({
      ...d,
      traits: d.traits.includes(key)
        ? d.traits.filter((t) => t !== key)
        : [...d.traits, key],
    }));
  };

  const startEdit = () => {
    setDraft(saved);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(saved);
    setEditing(false);
  };

  const save = async () => {
    try {
      await saveMutation.mutateAsync(toInput(draft));
      await refreshUser();
      setEditing(false);
      toast.success("Learning profile saved");
    } catch {
      toast.error("Couldn't save your profile. Please try again.");
    }
  };

  const reset = async () => {
    try {
      await saveMutation.mutateAsync(toInput(EMPTY));
      await refreshUser();
      setDraft(EMPTY);
      setEditing(false);
      toast.success("Learning profile reset");
    } catch {
      toast.error("Couldn't reset your profile. Please try again.");
    } finally {
      setConfirmReset(false);
    }
  };

  const busy = saveMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Learning Profile</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Aeva tailors explanations, quizzes, and study tips to these
            preferences. Changes affect future responses only.
          </p>
        </div>
        {configured ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            Personalized
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 gap-1">
            <CircleSlash className="h-3.5 w-3.5" />
            Not Configured
          </Badge>
        )}
      </div>

      {!editing && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setGuidedOpen(true)}
          className="w-full gap-1.5 sm:w-auto"
        >
          <Sparkles className="h-4 w-4 text-brand-1" />
          Edit step-by-step
        </Button>
      )}
      <OnboardingFlow
        open={guidedOpen}
        mode="edit"
        onDone={() => {
          setGuidedOpen(false);
          void refreshUser();
        }}
      />

      {!editing ? (
        <ProfileSummary
          profile={profile}
          isLoading={isLoading}
          configured={configured}
          onEdit={startEdit}
          onReset={() => setConfirmReset(true)}
          resettable={configured}
        />
      ) : (
        <div className="space-y-6">
          <SettingsField
            title="Education Level"
            hint="The single most useful detail for personalization."
          >
            <ChipSelect
              options={[...EDUCATION_LEVELS, OTHER]}
              selected={[draft.level]}
              onToggle={(o) => single("level", o)}
            />
            {draft.level === OTHER && (
              <Input
                value={draft.otherLevel}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, otherLevel: e.target.value }))
                }
                placeholder="Tell us what you're studying"
                className="mt-3"
              />
            )}
          </SettingsField>

          <SettingsField
            title="Exam Target"
            hint="Aeva adds exam-level insights, traps, and practice for this goal."
          >
            <ChipSelect
              options={EXAM_TARGETS}
              selected={[draft.examTarget]}
              onToggle={(o) => single("examTarget", o)}
            />
          </SettingsField>

          <SettingsField title="Preferred Language">
            <ChipSelect
              options={PREFERRED_LANGUAGES}
              selected={[draft.language]}
              onToggle={(o) => single("language", o)}
            />
          </SettingsField>

          <SettingsField title="Explanation Style">
            <ChipSelect
              options={EXPLANATION_STYLES}
              selected={[draft.style]}
              onToggle={(o) => single("style", o)}
            />
          </SettingsField>

          <SettingsField title="Favorite Subjects" hint="Pick as many as you like.">
            <ChipSelect
              options={FAVORITE_SUBJECTS}
              selected={draft.subjects}
              onToggle={toggleSubject}
            />
          </SettingsField>

          <SettingsField title="Learning Goal">
            <ChipSelect
              options={LEARNING_GOALS}
              selected={[draft.goal]}
              onToggle={(o) => single("goal", o)}
            />
          </SettingsField>

          <div className="space-y-6 rounded-2xl border border-border/60 bg-card/30 p-4">
            <div>
              <h4 className="text-sm font-semibold">
                How should Aeva interact with you?
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Controls Aeva's overall tone and teaching style.
              </p>
            </div>

            <SettingsField title="Personality">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {AI_PERSONALITIES.map((p) => {
                  const active = draft.personality === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => single("personality", p.value)}
                      className={cn(
                        "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                        active
                          ? "border-brand-1 bg-brand-1/5"
                          : "border-border/60 hover:bg-accent/40",
                      )}
                    >
                      <span className="text-lg leading-none">{p.emoji}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {p.value}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {p.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingsField>

            <SettingsField title="Communication Style">
              <ChipSelect
                options={COMMUNICATION_STYLES}
                selected={[draft.commStyle]}
                onToggle={(o) => single("commStyle", o)}
              />
            </SettingsField>

            <SettingsField
              title="Teaching Extras"
              hint="Pick what makes explanations click for you."
            >
              <ChipSelect
                options={LEARNING_TRAIT_OPTIONS.map((t) => t.label)}
                selected={LEARNING_TRAIT_OPTIONS.filter((t) =>
                  draft.traits.includes(t.key),
                ).map((t) => t.label)}
                onToggle={toggleTrait}
              />
            </SettingsField>

            <SettingsField title="Preferred Depth">
              <ChipSelect
                options={PREFERRED_DEPTHS}
                selected={[draft.depth]}
                onToggle={(o) => single("depth", o)}
              />
            </SettingsField>

            <SettingsField
              title="Custom AI Instructions"
              hint="Long-term preferences applied to future chats unless a request overrides them."
            >
              <Textarea
                value={draft.instructions}
                maxLength={CUSTOM_MAX}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, instructions: e.target.value }))
                }
                placeholder="Tell Aeva how you'd like it to help you…"
                className="min-h-[96px] resize-y"
              />
              <div className="mt-2 flex items-start justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {CUSTOM_INSTRUCTION_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          instructions: d.instructions.trim()
                            ? `${d.instructions.trim()} ${ex}`
                            : ex,
                        }))
                      }
                      className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50"
                    >
                      + {ex}
                    </button>
                  ))}
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {draft.instructions.length}/{CUSTOM_MAX}
                </span>
              </div>
            </SettingsField>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
            <Button variant="ghost" onClick={cancelEdit} disabled={busy}>
              Cancel
            </Button>
            {/* Save only appears once there are unsaved changes. */}
            {dirty && (
              <Button onClick={save} disabled={busy} className="gap-2">
                <Sparkles className="h-4 w-4" />
                {busy ? "Saving…" : "Save changes"}
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset learning profile?"
        description="This clears all your personalization choices. Aeva will stop tailoring responses until you set them up again."
        confirmText="Reset"
        destructive
        loading={busy}
        onConfirm={() => void reset()}
      />
    </div>
  );
}

const SUMMARY_FIELDS: ReadonlyArray<{
  label: string;
  get: (p: LearningProfile) => string;
}> = [
  { label: "Education Level", get: (p) => p.education_level ?? "" },
  { label: "Exam Target", get: (p) => p.exam_target ?? "" },
  { label: "Preferred Language", get: (p) => p.preferred_language ?? "" },
  {
    label: "Teaching Extras",
    get: (p) =>
      LEARNING_TRAIT_OPTIONS.filter((t) => p.learning_traits?.[t.key] === true)
        .map((t) => t.label)
        .join(", "),
  },
  {
    label: "Preferred Depth",
    get: (p) =>
      typeof p.learning_traits?.preferred_depth === "string"
        ? p.learning_traits.preferred_depth
        : "",
  },
  { label: "Explanation Style", get: (p) => p.explanation_style ?? "" },
  { label: "Favorite Subjects", get: (p) => p.favorite_subjects.join(", ") },
  { label: "Learning Goal", get: (p) => p.learning_goal ?? "" },
  { label: "Personality", get: (p) => p.ai_personality ?? "" },
  { label: "Communication Style", get: (p) => p.communication_style ?? "" },
  { label: "Custom Instructions", get: (p) => p.custom_instructions ?? "" },
];

function ProfileSummary({
  profile,
  isLoading,
  configured,
  onEdit,
  onReset,
  resettable,
}: {
  profile: LearningProfile | undefined;
  isLoading: boolean;
  configured: boolean;
  onEdit: () => void;
  onReset: () => void;
  resettable: boolean;
}) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading your profile…</p>
    );
  }

  return (
    <div className="space-y-4">
      {!configured && (
        <p className="rounded-xl bg-brand-1/5 px-4 py-3 text-sm text-muted-foreground">
          Personalization isn't set up yet. Add a few details so Aeva can adapt
          to how you learn.
        </p>
      )}

      {configured && profile && (
        <dl className="overflow-hidden rounded-2xl border border-border/60 bg-card/40 divide-y divide-border/50">
          {SUMMARY_FIELDS.map((field) => {
            const value = field.get(profile);
            return (
              <div
                key={field.label}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <dt className="text-sm text-muted-foreground">{field.label}</dt>
                <dd className="max-w-[60%] text-right text-sm font-medium">
                  {value || <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onEdit} className="gap-2">
          {configured ? (
            <>
              <Pencil className="h-4 w-4" />
              Edit profile
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Set up personalization
            </>
          )}
        </Button>
        {resettable && (
          <Button variant="ghost" onClick={onReset} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset profile
          </Button>
        )}
      </div>
    </div>
  );
}
