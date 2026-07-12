// Post-submission "Share": lets the user pick between sharing the QUIZ (a
// public link others can attempt) and sharing THEIR RESULT (a public result
// page with an "Attempt This Quiz" CTA). Each option mints/reuses its stable
// link, then shows the standard copy + social panel (or the native sheet).

import { useState } from "react";
import { BarChart3, ChevronLeft, ListChecks, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ShareLinkPanel } from "@/components/quiz/ShareLinkPanel";
import { createShare } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBackClose } from "@/hooks/useBackClose";
import { nativeShare } from "@/lib/share";

type Mode = "quiz" | "result";

const MODE_META: Record<
  Mode,
  { title: string; description: string; icon: typeof ListChecks }
> = {
  quiz: {
    title: "Share quiz",
    description: "Anyone with the link can attempt the quiz — no account needed.",
    icon: ListChecks,
  },
  result: {
    title: "Share my result",
    description:
      "Anyone with the link can see your score summary and attempt the quiz themselves.",
    icon: BarChart3,
  },
};

export function ShareResultButton({
  quizId,
  quizTitle,
  attemptId,
  className,
  variant = "outline",
  size,
}: {
  quizId: string;
  quizTitle: string;
  attemptId: string;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Mode | null>(null);
  // Chosen option + its minted link; null while the picker is showing.
  const [mode, setMode] = useState<Mode | null>(null);
  const [links, setLinks] = useState<Partial<Record<Mode, string>>>({});

  useBackClose(open, () => setOpen(false));

  const shareText = (m: Mode) =>
    m === "quiz"
      ? `Try this quiz: ${quizTitle}`
      : `See my result on "${quizTitle}" — and try the quiz yourself`;

  const pick = async (m: Mode) => {
    setBusy(m);
    try {
      const url =
        links[m] ??
        (m === "quiz"
          ? (await createShare("quiz", quizId)).url
          : (await createShare("quiz_result", attemptId)).url);
      setLinks((prev) => ({ ...prev, [m]: url }));
      const shared = isMobile
        ? await nativeShare({ title: quizTitle, text: shareText(m), url })
        : false;
      if (shared) {
        setOpen(false);
        return;
      }
      setMode(m);
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
      } catch {
        // Clipboard can be unavailable — the dialog still shows the link.
      }
    } catch {
      toast.error("Couldn't create a share link. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const openPicker = () => {
    setMode(null);
    setOpen(true);
  };

  const activeLink = mode ? links[mode] : undefined;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={openPicker}
        aria-label="Share quiz or result"
      >
        <Share2 className="h-4 w-4" /> Share
      </Button>

      <ResponsiveModal open={open} onOpenChange={setOpen}>
        <ResponsiveModalContent className="sm:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle className="flex items-center gap-1.5">
              {mode && (
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  aria-label="Back to share options"
                  className="-ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {mode ? MODE_META[mode].title : "Share"}
            </ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {mode
                ? MODE_META[mode].description
                : "Share the quiz itself, or your result on it."}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <ResponsiveModalBody className="py-2">
            {mode && activeLink ? (
              <ShareLinkPanel link={activeLink} shareText={shareText(mode)} />
            ) : (
              <div className="grid gap-2.5">
                {(Object.keys(MODE_META) as Mode[]).map((m) => {
                  const meta = MODE_META[m];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void pick(m)}
                      className="flex items-start gap-3 rounded-xl border border-border/60 p-3.5 text-left transition-colors hover:border-brand-1/40 hover:bg-brand-1/5 disabled:opacity-60"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-1/10 text-brand-1">
                        {busy === m ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">
                          {meta.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {meta.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  );
}
