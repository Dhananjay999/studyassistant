// "Share" for a quiz: mints (or reuses) a public link, copies it, and either
// opens the native OS share sheet (mobile) or a dialog with per-platform share
// options (desktop / no Web Share API). The link is a backend URL that renders
// social previews and redirects a human to the public quiz page.

import { useState, type ReactNode } from "react";
import { Loader2, Share2 } from "lucide-react";
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
import { useFeature } from "@/hooks/useFeature";
import { nativeShare } from "@/lib/share";

export function ShareQuizButton({
  quizId,
  quizTitle,
  children,
  className,
  variant = "outline",
  size,
}: {
  quizId: string;
  quizTitle: string;
  children?: ReactNode;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const isMobile = useIsMobile();
  const sharingEnabled = useFeature("sharing");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");

  useBackClose(open, () => setOpen(false));

  const shareText = `Try this quiz: ${quizTitle}`;

  const onShare = async () => {
    setBusy(true);
    try {
      const url = link || (await createShare("quiz", quizId)).url;
      setLink(url);
      // Mobile: try the native sheet first. If it isn't available (or failed),
      // fall back to the dialog.
      const shared = isMobile
        ? await nativeShare({ title: quizTitle, text: shareText, url })
        : false;
      if (shared) {
        return;
      }
      setOpen(true);
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
      } catch {
        // Clipboard can be unavailable — the dialog still shows the link.
      }
    } catch {
      toast.error("Couldn't create a share link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Admin kill switch: hiding here covers every call site at once.
  if (!sharingEnabled) return null;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void onShare();
        }}
        aria-label="Share quiz"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          children ?? (
            <>
              <Share2 className="h-4 w-4" />
              Share
            </>
          )
        )}
      </Button>

      <ResponsiveModal open={open} onOpenChange={setOpen}>
        <ResponsiveModalContent className="sm:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Share quiz</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Anyone with the link can attempt “{quizTitle}” — no account needed.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <ResponsiveModalBody className="py-2">
            {link && <ShareLinkPanel link={link} shareText={shareText} />}
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  );
}
