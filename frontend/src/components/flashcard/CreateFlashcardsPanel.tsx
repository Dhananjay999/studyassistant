import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isUsableTopic } from "@/components/chat/QuizSetupForm";
import { SourcePicker } from "@/components/create/SourcePicker";
import { useAppConfig, useGenerateFlashcards } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import {
  EMPTY_SOURCE,
  toGenerationSource,
  type SourceDraft,
} from "@/lib/generationSource";
import { cn } from "@/lib/utils";

const COUNT_OPTIONS = [5, 10, 15, 20, 30];
const DEFAULT_COUNT = 10;
const DEFAULT_MAX = 20;

/**
 * Flashcard Creation Panel for the Flashcards page — a lightweight, direct
 * entry point into the same flashcard generator Chat uses: pick the material
 * (topic, files or a note), how many cards, and generate. The deck is built
 * in the background and lands in the library when ready.
 */
export function CreateFlashcardsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const generate = useGenerateFlashcards();
  const { data: config } = useAppConfig();
  const max = config?.max_flashcard_cards ?? DEFAULT_MAX;
  const counts = COUNT_OPTIONS.filter((n) => n <= max);

  const [source, setSource] = useState<SourceDraft>(EMPTY_SOURCE);
  const [count, setCount] = useState(DEFAULT_COUNT);
  // "Custom" swaps the presets for a typed count (validated 1–max).
  const [customCount, setCustomCount] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const material = toGenerationSource(source);
  // A typed topic is the only material, so it must be one the generator can
  // work from (same rule as the quiz setup form in Chat).
  const topicOk = source.kind !== "topic" || isUsableTopic(source.topic);

  const isCustom = customCount !== null;
  const customNum = Number(customCount);
  const customValid =
    Number.isInteger(customNum) && customNum >= 1 && customNum <= max;
  const countValid = !isCustom || customValid;

  const submit = () => {
    if (!material || !countValid || !topicOk) return;
    const cards = Math.min(isCustom ? customNum : count, max);
    analytics.track(AnalyticsEvent.FLASHCARDS_GENERATION_REQUESTED, {
      chat_session_id: null,
      source: "flashcards_page",
      material: material.source,
      count: cards,
      has_instructions: !!details.trim(),
    });
    onOpenChange(false);
    setSource(EMPTY_SOURCE);
    setDetails("");

    // mutateAsync so the outcome toast still fires after navigating away.
    generate
      .mutateAsync({
        ...material,
        count: cards,
        additional_instructions: details.trim() || undefined,
      })
      .then(
        (set) =>
          toast.success("Your flashcards are ready", {
            description: set.title,
            action: {
              label: "Study",
              onClick: () => navigate(`/flashcards?setId=${set.set_id}`),
            },
          }),
        (err) => {
          analytics.track(AnalyticsEvent.FLASHCARDS_CREATE_FAILED, {
            error_kind: errorKind(err),
            material: material.source,
          });
          toast.error("Couldn't create your flashcards", {
            description: friendlyErrorMessage(err),
          });
        },
      );
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="font-display">
            Create flashcards
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Aeva will turn it into a deck in your library.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <ResponsiveModalBody className="space-y-4 overscroll-contain px-1">
          <div className="space-y-1.5">
            <SourcePicker
              question="What do you want to create flashcards for?"
              value={source}
              onChange={setSource}
            />
            {!topicOk && (
              <p className="text-[10px] text-muted-foreground">
                Add a topic of at least two words (e.g. "Photosynthesis class
                10").
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Number of cards</Label>
            <div className="flex flex-wrap gap-2">
              {counts.map((n) => (
                <CountChip
                  key={n}
                  active={!isCustom && count === n}
                  onClick={() => {
                    setCount(n);
                    setCustomCount(null);
                  }}
                >
                  {n}
                </CountChip>
              ))}
              <CountChip
                active={isCustom}
                onClick={() => setCustomCount(customCount ?? String(count))}
              >
                Custom
              </CountChip>
            </div>
            {isCustom && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={max}
                  autoFocus
                  aria-label="Number of cards"
                  value={customCount}
                  onChange={(e) => setCustomCount(e.target.value)}
                  className={cn(
                    "h-8 w-24",
                    !customValid && "border-destructive",
                  )}
                />
                <span
                  className={cn(
                    "text-[11px]",
                    customValid ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  1–{max} cards
                </span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Additional details (optional)</Label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. Focus on definitions and formulas, add an example to each card"
              rows={2}
              maxLength={1000}
              className="resize-none text-sm"
            />
          </div>
        </ResponsiveModalBody>
        <ResponsiveModalFooter>
          <Button
            onClick={submit}
            disabled={!material || !countValid || !topicOk}
            className="w-full gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Generate flashcards
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function CountChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
