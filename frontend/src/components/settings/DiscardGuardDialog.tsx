import { ConfirmModal } from "@/components/common/ConfirmModal";

/** Confirmation shown when leaving a settings section with unsaved edits.
 * Built on ConfirmModal so it's a native-style bottom sheet on mobile. */
export function DiscardGuardDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title="Discard unsaved changes?"
      description="You have unsaved changes to your learning profile. If you leave now, they'll be lost."
      confirmText="Discard"
      cancelText="Keep editing"
      destructive
      onConfirm={onConfirm}
    />
  );
}
