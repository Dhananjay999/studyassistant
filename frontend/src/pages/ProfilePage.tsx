import { useNavigate } from "react-router-dom";
import { ChevronRight, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageContainer } from "@/components/layout/PageContainer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmLogout } from "@/hooks/useConfirmLogout";
import { getSection } from "@/components/settings/sections";
import type {
  SettingsSection,
  SettingsSectionId,
} from "@/components/settings/types";

// Grouped cards on the profile menu (iOS/ChatGPT-style grouping). Mirrors the
// grouping previously used by the mobile settings overlay.
const MENU_GROUPS: ReadonlyArray<{
  title: string;
  ids: SettingsSectionId[];
}> = [
  { title: "Account", ids: ["account", "learning"] },
  { title: "Preferences", ids: ["appearance", "voice", "shortcuts"] },
  { title: "Support", ids: ["about"] },
];

/**
 * Mobile Profile — a normal in-shell page (header + bottom nav stay visible),
 * NOT a fullscreen overlay. Shows the grouped section menu; tapping a section
 * routes to `/profile/:section`, so the phone's back gesture returns here
 * naturally. Desktop still opens the Settings modal (this route is unused
 * there).
 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirmLogout = useConfirmLogout();

  return (
    <PageContainer title="Profile">
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
        <ProfileHeader
          name={user?.full_name || "Student"}
          email={user?.email}
          avatarUrl={user?.avatar_url}
          onClick={() => navigate("/profile/account")}
        />

        {MENU_GROUPS.map((group) => (
          <div key={group.title} className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
              {group.ids.map((id) => (
                <MenuRow
                  key={id}
                  section={getSection(id)}
                  onClick={() => navigate(`/profile/${id}`)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
          <button
            type="button"
            onClick={() => confirmLogout()}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>
    </PageContainer>
  );
}

function ProfileHeader({
  name,
  email,
  avatarUrl,
  onClick,
}: {
  name: string;
  email?: string;
  avatarUrl?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 text-left transition-colors hover:bg-accent/40"
    >
      <Avatar className="h-12 w-12">
        <AvatarImage src={avatarUrl || undefined} alt={name} />
        <AvatarFallback>{name[0] || email?.[0] || "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-sm text-muted-foreground">{email}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function MenuRow({
  section,
  onClick,
}: {
  section: SettingsSection;
  onClick: () => void;
}) {
  const Icon = section.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors hover:bg-accent/50"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 font-medium">{section.label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
