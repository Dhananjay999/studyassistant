// "Share" for a quiz: mints (or reuses) a public link, copies it, and either
// opens the native OS share sheet (mobile) or a dialog with per-platform share
// options (desktop / no Web Share API). The link is a backend URL that renders
// social previews and redirects a human to the public quiz page.

import { useState, type ReactNode } from "react";
import { Check, Copy, Loader2, Mail, Share2 } from "lucide-react";
import {
  FaFacebookF,
  FaLinkedinIn,
  FaTelegram,
  FaWhatsapp,
  FaXTwitter,
} from "react-icons/fa6";
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
import { Input } from "@/components/ui/input";
import { createQuizShare } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBackClose } from "@/hooks/useBackClose";
import { buildShareLinks, nativeShare, type SharePlatform } from "@/lib/share";

const SOCIALS: {
  key: SharePlatform;
  label: string;
  icon: typeof FaWhatsapp;
  className: string;
}[] = [
  { key: "whatsapp", label: "WhatsApp", icon: FaWhatsapp, className: "bg-[#25D366]" },
  { key: "telegram", label: "Telegram", icon: FaTelegram, className: "bg-[#229ED9]" },
  { key: "twitter", label: "X", icon: FaXTwitter, className: "bg-black" },
  { key: "linkedin", label: "LinkedIn", icon: FaLinkedinIn, className: "bg-[#0A66C2]" },
  { key: "facebook", label: "Facebook", icon: FaFacebookF, className: "bg-[#1877F2]" },
  { key: "email", label: "Email", icon: Mail, className: "bg-muted-foreground" },
];

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  useBackClose(open, () => setOpen(false));

  const shareText = `Try this quiz: ${quizTitle}`;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      return true;
    } catch {
      return false;
    }
  };

  const onShare = async () => {
    setBusy(true);
    try {
      const url = link || (await createQuizShare(quizId)).url;
      setLink(url);
      const didCopy = await copy(url);
      // Mobile: try the native sheet first. If it isn't available (or failed),
      // fall back to the dialog.
      const shared = isMobile
        ? await nativeShare({ title: quizTitle, text: shareText, url })
        : false;
      if (shared) {
        return;
      }
      setOpen(true);
      if (didCopy) toast.success("Link copied to clipboard");
    } catch {
      toast.error("Couldn't create a share link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const links = link ? buildShareLinks(link, shareText) : null;

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

          <ResponsiveModalBody className="space-y-4 py-2">
            {/* Copy link — the primary action */}
            <div className="flex gap-2">
              <Input readOnly value={link} className="text-xs" />
              <Button
                onClick={() => void copy(link).then((ok) => ok && toast.success("Copied"))}
                className="shrink-0 gap-1.5"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            {/* Social targets */}
            {links && (
              <div className="grid grid-cols-3 gap-3">
                {SOCIALS.map(({ key, label, icon: Icon, className: cls }) => (
                  <a
                    key={key}
                    href={links[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 p-3 transition-colors hover:bg-muted"
                  >
                    <span
                      className={`grid h-10 w-10 place-items-center rounded-full text-white ${cls}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {label}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  );
}
