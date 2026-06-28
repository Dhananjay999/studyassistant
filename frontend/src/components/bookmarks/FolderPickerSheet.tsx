// Folder picker presented as a bottom sheet (mobile) / dialog (desktop). Used
// to move one or many bookmarks into a collection. "Unfiled" moves to no
// collection (collection_id = null).

import {
  Folder,
  FolderMinus,
  Loader2,
} from "lucide-react";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { cn } from "@/lib/utils";

export function FolderPickerSheet({
  open,
  onOpenChange,
  collections,
  currentId,
  count = 1,
  busy = false,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Array<{ id: string; name: string }>;
  /** Currently-assigned collection, shown with a check (single move only). */
  currentId?: string | null;
  /** How many bookmarks are being moved (for the heading). */
  count?: number;
  busy?: boolean;
  onPick: (collectionId: string | null) => void;
}) {
  const rows: Array<{ id: string | null; name: string; unfiled?: boolean }> = [
    { id: null, name: "Unfiled", unfiled: true },
    ...collections.map((c) => ({ id: c.id, name: c.name })),
  ];

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} dismissible={!busy}>
      <ResponsiveModalContent className="sm:max-w-sm">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Move to folder</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {count === 1
              ? "Choose a folder for this bookmark."
              : `Choose a folder for ${count} bookmarks.`}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <ResponsiveModalBody className="max-h-[55vh] py-1">
          <ul className="flex flex-col gap-0.5">
            {rows.map((row) => {
              const active = currentId !== undefined && row.id === currentId;
              const Icon = row.unfiled ? FolderMinus : Folder;
              return (
                <li key={row.id ?? "__unfiled"}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(row.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors disabled:opacity-60",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{row.name}</span>
                    {active && (
                      <span className="text-xs text-muted-foreground">
                        Current
                      </span>
                    )}
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  </button>
                </li>
              );
            })}
            {collections.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No folders yet. Create one from the Bookmarks page.
              </li>
            )}
          </ul>
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
