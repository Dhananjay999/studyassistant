// "Export as PDF" for a quiz: a trigger button plus an options bottom sheet
// (Include Answer Key + paper size). On export it fetches the owner-only quiz
// payload (with answers) and builds the PDF client-side via jspdf, which is
// dynamically imported inside downloadQuizPdf so it stays out of the main
// bundle.

import { useState, type ReactNode } from "react";
import { Download, FileDown, Loader2 } from "lucide-react";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getQuizExport } from "@/lib/api";
import { useBackClose } from "@/hooks/useBackClose";
import { downloadQuizPdf, type PaperSize } from "@/lib/quizPdf";
import { cn } from "@/lib/utils";

const PAPERS: { value: PaperSize; label: string; hint: string }[] = [
  { value: "a4", label: "A4", hint: "210 × 297 mm" },
  { value: "letter", label: "Letter", hint: "8.5 × 11 in" },
];

export function QuizExportButton({
  quizId,
  quizTitle,
  children,
  className,
  variant = "outline",
  size,
}: {
  quizId: string;
  quizTitle: string;
  /** Trigger content; defaults to a labeled "Export PDF" button. */
  children?: ReactNode;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [open, setOpen] = useState(false);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(false);
  const [paper, setPaper] = useState<PaperSize>("a4");
  const [busy, setBusy] = useState(false);

  // Back gesture/button dismisses the options sheet (unless mid-export).
  useBackClose(open, () => {
    if (!busy) setOpen(false);
  });

  const onExport = async () => {
    setBusy(true);
    try {
      const quiz = await getQuizExport(quizId);
      await downloadQuizPdf(quiz, { includeAnswerKey, paper });
      setOpen(false);
      toast.success("Quiz exported as PDF");
    } catch {
      toast.error("Couldn't export the quiz. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Export quiz as PDF"
      >
        {children ?? (
          <>
            <FileDown className="h-4 w-4" />
            Export PDF
          </>
        )}
      </Button>

      <ResponsiveModal
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        dismissible={!busy}
      >
        <ResponsiveModalContent className="sm:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Export as PDF</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Save “{quizTitle}” as a printable exam-style question paper.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <ResponsiveModalBody className="space-y-5 py-2">
            {/* Answer key toggle */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="answer-key" className="text-sm font-medium">
                  Include Answer Key
                </Label>
                <p className="text-xs text-muted-foreground">
                  Append the correct answers on a final page.
                </p>
              </div>
              <Switch
                id="answer-key"
                checked={includeAnswerKey}
                onCheckedChange={setIncludeAnswerKey}
              />
            </div>

            {/* Paper size */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Paper size</Label>
              <div className="grid grid-cols-2 gap-2">
                {PAPERS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPaper(p.value)}
                    className={cn(
                      "flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors",
                      paper === p.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="text-sm font-semibold">{p.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {p.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </ResponsiveModalBody>

          <ResponsiveModalFooter>
            <Button
              onClick={onExport}
              disabled={busy}
              className="w-full gap-2 sm:w-auto"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {busy ? "Preparing…" : "Export PDF"}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  );
}
