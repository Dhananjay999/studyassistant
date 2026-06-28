// Read-only conversation viewer for one session. Used by both the user-detail
// view and the global sessions manager.

import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminSession } from "@/hooks/adminApi";

export function SessionDialog({
  sessionId,
  onClose,
}: {
  sessionId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useAdminSession(sessionId);
  return (
    <ResponsiveModal
      open={sessionId !== null}
      onOpenChange={(o) => !o && onClose()}
    >
      <ResponsiveModalContent className="max-h-[80vh] sm:max-w-2xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="truncate">
            {data?.session.title || "Conversation"}
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <ResponsiveModalBody>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.messages ?? []).map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border bg-muted/30 p-3 text-sm"
                >
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    {m.role}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              ))}
              {!data?.messages.length && (
                <p className="text-sm text-muted-foreground">No messages.</p>
              )}
            </div>
          )}
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
