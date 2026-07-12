// Copy-link input + per-platform social targets. The body every share dialog
// (quiz link, result link) renders once a public URL has been minted.

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import {
  FaFacebookF,
  FaLinkedinIn,
  FaTelegram,
  FaWhatsapp,
  FaXTwitter,
} from "react-icons/fa6";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildShareLinks, type SharePlatform } from "@/lib/share";

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

export function ShareLinkPanel({
  link,
  shareText,
}: {
  link: string;
  shareText: string;
}) {
  const [copied, setCopied] = useState(false);
  const links = buildShareLinks(link, shareText);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <div className="space-y-4">
      {/* Copy link — the primary action */}
      <div className="flex gap-2">
        <Input readOnly value={link} className="text-xs" />
        <Button onClick={() => void copy()} className="shrink-0 gap-1.5">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {/* Social targets */}
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
            <span className="text-[11px] text-muted-foreground">{label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
