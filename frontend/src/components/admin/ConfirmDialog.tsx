// Reusable confirmation modal for admin actions. For high-blast-radius
// global wipes, pass `confirmWord` to require the admin to type it first.

import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** When set, the confirm button stays disabled until this is typed. */
  confirmWord?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmWord,
  destructive = true,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  // Reset the typed guard whenever the dialog opens/closes.
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const guardOk = !confirmWord || typed.trim() === confirmWord;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !loading && onOpenChange(o)}
      dismissible={!loading}
    >
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
          {description && (
            <ResponsiveModalDescription asChild>
              <div className="text-sm text-muted-foreground">
                {description}
              </div>
            </ResponsiveModalDescription>
          )}
        </ResponsiveModalHeader>

        {confirmWord && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Type{" "}
              <span className="font-mono font-semibold text-foreground">
                {confirmWord}
              </span>{" "}
              to confirm.
            </p>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmWord}
            />
          </div>
        )}

        <ResponsiveModalFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading || !guardOk}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmText}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
