import { ImagePlus, LogOut, Mail, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { SettingsGroup } from "@/components/settings/primitives";

/** Account identity + session controls. */
export function AccountSection() {
  const { user, logout } = useAuth();
  const { close } = useSettings();

  const name = user?.full_name || "Student";
  const initial = user?.full_name?.[0] || user?.email?.[0] || "?";

  const signOut = () => {
    close();
    logout();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border/60 bg-card/40 p-6 text-center sm:flex-row sm:items-center sm:text-left">
        <Avatar className="h-20 w-20 text-xl">
          <AvatarImage src={user?.avatar_url || undefined} alt={name} />
          <AvatarFallback className="text-xl font-semibold">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{name}</h3>
          <p className="mt-0.5 flex items-center justify-center gap-1.5 text-sm text-muted-foreground sm:justify-start">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{user?.email}</span>
          </p>
          <div className="mt-2 flex justify-center sm:justify-start">
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Google Account
            </Badge>
          </div>
        </div>
      </div>

      <SettingsGroup title="Profile">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Profile picture</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Synced from your Google account.
            </p>
          </div>
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <ImagePlus className="h-4 w-4" />
            Change
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Session">
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </SettingsGroup>
    </div>
  );
}
