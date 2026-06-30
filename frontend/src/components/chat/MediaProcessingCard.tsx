import { AnimatePresence, motion } from "framer-motion";
import { RotateCw, X } from "lucide-react";
import { PROCESSING_STAGES, type UploadProgress } from "@/types";

/** Resolve the stage copy + icon to show for an upload's current status. */
function stageMeta(u: UploadProgress) {
  if (u.status === "uploading") return PROCESSING_STAGES.uploading;
  if (u.status === "ready") return PROCESSING_STAGES.ready;
  if (u.status === "error") return PROCESSING_STAGES.error;
  return u.stage ? PROCESSING_STAGES[u.stage] : PROCESSING_STAGES.pending;
}

/** Prefer the live backend message; fall back to the stage's static label. */
function stageLabel(u: UploadProgress): string {
  const meta = stageMeta(u);
  if (u.status === "uploading") return meta.label;
  return u.message?.trim() || meta.label;
}

/**
 * A single in-flight upload, rendered as engaging, real-time AI-style
 * processing feedback: an animated stage icon, the live SSE message crossfading
 * as stages advance, and a shimmering gradient progress bar. Terminal states
 * collapse to a clean "ready" flourish or an error with a Retry affordance.
 */
export function MediaProcessingCard({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: UploadProgress;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const meta = stageMeta(upload);
  const label = stageLabel(upload);
  const isError = upload.status === "error";
  const isReady = upload.status === "ready";
  const active = !isError && !isReady;
  const pct = Math.max(0, Math.min(100, upload.progress));

  return (
    <div
      className={
        "relative overflow-hidden rounded-xl border p-2.5 transition-colors " +
        (isError
          ? "border-destructive/40 bg-destructive/5"
          : isReady
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-brand-1/30 bg-brand-1/[0.04]")
      }
    >
      {/* Soft animated glow behind active processing. */}
      {active && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-xl bg-gradient-to-r from-brand-1/10 via-brand-3/10 to-brand-2/10"
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <div className="relative flex items-center gap-2.5">
        {/* Animated stage icon (crossfades as the stage advances). */}
        <div className="grid h-8 w-8 shrink-0 place-items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={meta.emoji}
              initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.4, opacity: 0, rotate: 20 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="text-xl leading-none"
            >
              <motion.span
                className="inline-block"
                animate={
                  active
                    ? { y: [0, -2.5, 0], rotate: [0, -5, 5, 0] }
                    : { y: 0, rotate: 0 }
                }
                transition={{ duration: 2.2, repeat: active ? Infinity : 0, ease: "easeInOut" }}
              >
                {meta.emoji}
              </motion.span>
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-xs font-medium">
              {upload.name}
            </span>
            {active && (
              <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                {pct}%
              </span>
            )}
          </div>

          {/* Live stage message — crossfades as the SSE stream advances. */}
          <div className="mt-0.5 h-4 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={label}
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -8, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className={
                  "truncate text-[11px] " +
                  (isError
                    ? "text-destructive"
                    : isReady
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground")
                }
              >
                {label}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {isError && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="grid h-6 w-6 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Shimmering progress bar while active. */}
      {active && (
        <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-1 via-brand-3 to-brand-2"
            initial={false}
            animate={{ width: `${Math.max(pct, 4)}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 20 }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent"
            animate={{ x: ["-120%", "420%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}
    </div>
  );
}
