// An iOS-style swipe-to-act row. Dragging the content horizontally reveals a
// coloured action panel behind it; releasing past a threshold (or with enough
// velocity) fires that side's action, then the content springs back. There is
// no persistent "open" state, so a normal tap still passes through to the
// content — and because the action also has a visible button elsewhere in the
// UI, the gesture is a shortcut, never the only way to do something.

import { type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "framer-motion";
import { cn } from "@/lib/utils";

export interface SwipeAction {
  icon: ReactNode;
  label: string;
  onAction: () => void;
  /** Background + text colour utilities for the revealed panel. */
  className?: string;
}

const MAX_DRAG = 132;
const COMMIT = 88;
const FLING_VELOCITY = 600;

export function SwipeableRow({
  children,
  leading,
  trailing,
  disabled = false,
  className,
}: {
  children: ReactNode;
  /** Revealed by swiping right (panel sits on the left edge). */
  leading?: SwipeAction;
  /** Revealed by swiping left (panel sits on the right edge). */
  trailing?: SwipeAction;
  disabled?: boolean;
  className?: string;
}) {
  const x = useMotionValue(0);
  const leadingProgress = useTransform(x, [0, COMMIT], [0, 1]);
  const trailingProgress = useTransform(x, [-COMMIT, 0], [1, 0]);

  if (disabled || (!leading && !trailing)) {
    return <div className={className}>{children}</div>;
  }

  const springBack = () =>
    animate(x, 0, { type: "spring", stiffness: 600, damping: 42 });

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (trailing && (offset.x < -COMMIT || velocity.x < -FLING_VELOCITY)) {
      trailing.onAction();
    } else if (leading && (offset.x > COMMIT || velocity.x > FLING_VELOCITY)) {
      leading.onAction();
    }
    springBack();
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {leading && (
        <ActionPanel
          side="leading"
          action={leading}
          progress={leadingProgress}
          onClick={() => {
            leading.onAction();
            springBack();
          }}
        />
      )}
      {trailing && (
        <ActionPanel
          side="trailing"
          action={trailing}
          progress={trailingProgress}
          onClick={() => {
            trailing.onAction();
            springBack();
          }}
        />
      )}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{
          left: trailing ? -MAX_DRAG : 0,
          right: leading ? MAX_DRAG : 0,
        }}
        dragElastic={0.08}
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={onDragEnd}
        className="relative z-10 h-full bg-background"
      >
        {children}
      </motion.div>
    </div>
  );
}

function ActionPanel({
  side,
  action,
  progress,
  onClick,
}: {
  side: "leading" | "trailing";
  action: SwipeAction;
  progress: MotionValue<number>;
  onClick: () => void;
}) {
  const scale = useTransform(progress, [0, 0.6, 1], [0.6, 1, 1.12]);
  return (
    <motion.button
      type="button"
      aria-label={action.label}
      tabIndex={-1}
      onClick={onClick}
      style={{ opacity: progress }}
      className={cn(
        "absolute inset-y-0 flex w-32 items-center text-white",
        side === "leading"
          ? "left-0 justify-start pl-5"
          : "right-0 justify-end pr-5",
        action.className,
      )}
    >
      <motion.span style={{ scale }} className="flex flex-col items-center gap-1">
        {action.icon}
        <span className="text-[11px] font-medium">{action.label}</span>
      </motion.span>
    </motion.button>
  );
}
