import { ExternalLink, FileText, MessageSquareHeart, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { SettingsGroup } from "@/components/settings/primitives";
import { APP_META } from "@/components/settings/constants";

const LINKS: ReadonlyArray<{
  label: string;
  href: string;
  icon: LucideIcon;
}> = [
  { label: "Privacy Policy", href: APP_META.links.privacy, icon: Shield },
  { label: "Terms of Service", href: APP_META.links.terms, icon: FileText },
  {
    label: "Send Feedback",
    href: APP_META.links.feedback,
    icon: MessageSquareHeart,
  },
];

/** App identity, version/build, and legal/feedback links. */
export function AboutSection() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-6 text-center">
        <BrandLogo withWordmark={false} />
        <div>
          <h3 className="text-lg font-semibold">{APP_META.name}</h3>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {APP_META.tagline}
          </p>
        </div>
      </div>

      <SettingsGroup title="Version">
        <dl className="divide-y divide-border/50">
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted-foreground">Version</dt>
            <dd className="text-sm font-medium">{APP_META.version}</dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted-foreground">Build</dt>
            <dd className="font-mono text-sm font-medium">{APP_META.build}</dd>
          </div>
        </dl>
      </SettingsGroup>

      <SettingsGroup title="Legal & support">
        <ul className="divide-y divide-border/50">
          {LINKS.map((link) => {
            const Icon = link.icon;
            const external = !link.href.startsWith("mailto:");
            return (
              <li key={link.label}>
                <a
                  href={link.href}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                  className="flex items-center gap-3 px-4 py-3.5 text-sm transition-colors hover:bg-accent/50"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{link.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </a>
              </li>
            );
          })}
        </ul>
      </SettingsGroup>
    </div>
  );
}
