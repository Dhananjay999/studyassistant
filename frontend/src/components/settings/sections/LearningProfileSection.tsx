import { useEffect, useMemo, useState } from "react";
import { CircleSlash, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
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
  LEARNING_TRAIT_OPTIONS,
  PREFERRED_DEPTHS,
} from "@/lib/learningProfile";
import {
  CUSTOM_MAX as LANGUAGE_MAX,
  describeContext,
  LANGUAGES,
  LANGUAGE_EXAMPLES,
  LANGUAGE_NOTE,
  OTHER_LABEL,
  STYLES,
} from "@/lib/onboarding";
import type { LearningProfile, LearningProfileInput } from "@/types";

const CUSTOM_MAX = 1000;

const OTHER = OTHER_LABEL;
const LANGUAGE_LABELS = LANGUAGES.map((o) => o.label);
const STYLE_LABELS = STYLES.map((o) => o.label);

/**
 * Fields this form edits directly. The learning context, goal, focus areas
 * and exam depend on each other, so they are only changed through the
 * step-by-step flow (same questions and options as onboarding) and are
 * passed through untouched on save.
 */
interface Draft {
  language: string;
  otherLanguage: string;
  style: string;
  personality: string;
  commStyle: string;
  instructions: string;
  traits: string[];
  depth: string;
}

const EMPTY: Draft = {
  language: "",
  otherLanguage: "",
  style: "",
  personality: "",
  commStyle: "",
  instructions: "",
  traits: [],
  depth: "",
};

/** Seed editable draft state from a saved profile row. */
function toDraft(profile: LearningProfile | undefined): Draft {
  if (!profile) return EMPTY;
  const savedLanguage = profile.response_language?.trim() ?? "";
  const knownLanguage = LANGUAGE_LABELS.find(
    (l) => l.toLowerCase() === savedLanguage.toLowerCase(),
  );
  return {
    language: savedLanguage ? (knownLanguage ?? OTHER) : "",
    otherLanguage: savedLanguage && !knownLanguage ? savedLanguage : "",
    style: profile.explanation_style ?? "",
    personality: profile.ai_personality ?? "",
    commStyle: profile.communication_style ?? "",
    instructions: profile.custom_instructions ?? "",
    traits: LEARNING_TRAIT_OPTIONS.filter(
      (t) => profile.learning_traits?.[t.key] === true,
    ).map((t) => t.key),
    depth:
      typeof profile.learning_traits?.preferred_depth === "string"
        ? profile.learning_traits.preferred_depth
        : "",
  };
}

/** Full PUT payload: draft fields + the step-by-step answers unchanged
 * (pass `null` to clear those too, as Reset does). */
function toInput(
  draft: Draft,
  profile: LearningProfile | null | undefined,
): LearningProfileInput {
  const language =
    draft.language === OTHER ? draft.otherLanguage.trim() : draft.language;
  const traits: Record<string, boolean | string> = {};
  for (const t of LEARNING_TRAIT_OPTIONS) {
    if (draft.traits.includes(t.key)) traits[t.key] = true;
  }
  if (draft.depth) traits.preferred_depth = draft.depth;
  return {
    context: profile?.context ?? {},
    goal: profile?.goal ?? null,
    focus_areas: profile?.focus_areas ?? [],
    response_language: language || null,
    explanation_style: draft.style || null,
    ai_personality: draft.personality || null,
    communication_style: draft.commStyle || null,
    custom_instructions: draft.instructions.trim() || null,
    learning_traits: traits,
  };
}

/** True when at least one field carries a value (drives the status badge). */
function hasAnyValue(input: LearningProfileInput): boolean {
  return Boolean(
    (input.context && Object.keys(input.context).length > 0) ||
      input.response_language ||
      input.explanation_style ||
      input.goal ||
      input.ai_personality ||
      input.communication_style ||
      input.custom_instructions ||
      (input.learning_traits &&
        Object.keys(input.learning_traits).length > 0) ||
      (input.focus_areas && input.focus_areas.length > 0),
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
    hasAnyValue(toInput(saved, profile));

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
    analytics.track(AnalyticsEvent.LEARNING_PROFILE_EDIT_STARTED);
    setDraft(saved);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(saved);
    setEditing(false);
  };

  const save = async () => {
    try {
      const input = toInput(draft, profile);
      await saveMutation.mutateAsync(input);
      analytics.track(AnalyticsEvent.LEARNING_PROFILE_SAVED, {
        fields_set: Object.values(input).filter((v) =>
          Array.isArray(v) ? v.length > 0 : !!v,
        ).length,
      });
      await refreshUser();
      setEditing(false);
      toast.success("Learning profile saved");
    } catch {
      toast.error("Couldn't save your profile. Please try again.");
    }
  };

  const reset = async () => {
    try {
      await saveMutation.mutateAsync(toInput(EMPTY, null));
      analytics.track(AnalyticsEvent.LEARNING_PROFILE_RESET);
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

  // Context-dependent answers are edited in the guided flow; leave the
  // manual form first so its draft can't overwrite what the flow saves.
  const openGuided = () => {
    setEditing(false);
    setGuidedOpen(true);
  };

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
          onClick={openGuided}
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
            title="Learning Context, Goal & Focus"
            hint="These depend on each other, so they're updated step-by-step."
          >
            <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm">
              {CONTEXT_FIELDS.map((field) => {
                const value = profile ? field.get(profile) : "";
                return (
                  <div key={field.label} className="flex justify-between gap-4 py-1">
                    <span className="text-muted-foreground">{field.label}</span>
                    <span className="text-right font-medium">
                      {value || <span className="text-muted-foreground">—</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {dirty ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Save or cancel your other changes first to edit these.
              </p>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={openGuided}
                className="mt-3 gap-1.5"
              >
                <Sparkles className="h-4 w-4 text-brand-1" />
                Edit step-by-step
              </Button>
            )}
          </SettingsField>

          <SettingsField title="Response Language" hint={LANGUAGE_NOTE}>
            <ChipSelect
              options={[...LANGUAGE_LABELS, OTHER]}
              selected={[draft.language]}
              onToggle={(o) => single("language", o)}
            />
            {draft.language === OTHER && (
              <>
                <Input
                  value={draft.otherLanguage}
                  maxLength={LANGUAGE_MAX}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, otherLanguage: e.target.value }))
                  }
                  placeholder="Type your preferred language…"
                  className="mt-3"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {LANGUAGE_EXAMPLES}
                </p>
              </>
            )}
          </SettingsField>

          <SettingsField title="Explanation Style">
            <ChipSelect
              options={STYLE_LABELS}
              selected={[draft.style]}
              onToggle={(o) => single("style", o)}
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

type SummaryField = { label: string; get: (p: LearningProfile) => string };

/** Answers owned by the step-by-step flow (shown read-only in the form). */
const CONTEXT_FIELDS: ReadonlyArray<SummaryField> = [
  { label: "Learning Context", get: (p) => describeContext(p.context) },
  { label: "Exam", get: (p) => p.context?.exam ?? "" },
  { label: "Learning Goal", get: (p) => p.goal ?? "" },
  { label: "Focus Areas", get: (p) => p.focus_areas.join(", ") },
];

const SUMMARY_FIELDS: ReadonlyArray<SummaryField> = [
  ...CONTEXT_FIELDS,
  { label: "Response Language", get: (p) => p.response_language ?? "" },
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
