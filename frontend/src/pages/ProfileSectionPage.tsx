import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useHeaderSlot } from "@/components/layout/HeaderSlot";
import { SETTINGS_SECTIONS, getSection } from "@/components/settings/sections";
import type { SettingsSectionId } from "@/components/settings/types";
import { DiscardGuardDialog } from "@/components/settings/DiscardGuardDialog";
import { useDiscardGuard } from "@/components/settings/useDiscardGuard";

/**
 * Mobile Profile section (`/profile/:section`) — renders one standalone
 * settings section inside the app shell. Back returns to the `/profile` menu
 * (discard-guarded when the section has unsaved edits, via the shared
 * `SettingsContext.dirty` wiring). An unknown section id redirects to the menu.
 */
export default function ProfileSectionPage() {
  const { section = "" } = useParams();
  const navigate = useNavigate();
  const valid = SETTINGS_SECTIONS.some((s) => s.id === section);
  const entry = getSection(section as SettingsSectionId);
  const { guard, isPrompting, confirm, cancel } = useDiscardGuard();

  const goBack = () => guard(() => navigate("/profile"));

  useHeaderSlot(
    {
      start: (
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            className="-ml-1 flex items-center rounded-lg p-1.5 text-foreground transition-colors hover:bg-accent/50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="truncate text-sm font-medium">{entry.label}</span>
        </div>
      ),
    },
    [entry.label, guard],
  );

  if (!valid) return <Navigate to="/profile" replace />;

  const Component = entry.Component;
  return (
    <div className="h-full overflow-y-auto pb-bottomnav lg:pb-0">
      <div className="mx-auto w-full max-w-2xl p-4">
        <Component />
      </div>
      <DiscardGuardDialog
        open={isPrompting}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </div>
  );
}
