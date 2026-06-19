import { motion, PanInfo } from "framer-motion";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";

interface SessionSidebarProps {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSwipeClose?: () => void;
}

export function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onSwipeClose,
}: SessionSidebarProps) {
  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -80) onSwipeClose?.();
  };

  return (
    <motion.aside
      drag={onSwipeClose ? "x" : false}
      dragConstraints={{ left: -200, right: 0 }}
      dragElastic={0.1}
      onDragEnd={handleDragEnd}
      className="flex h-full w-72 flex-col border-r border-border/50 bg-sidebar"
    >
      <div className="flex flex-col gap-2 p-3">
        <Button
          onClick={() => onNew()}
          className="w-full justify-start gap-2 rounded-xl"
          variant="default"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="flex flex-col gap-1 pb-4">
          {sessions.map((session) => (
            <motion.button
              key={session.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(session.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onDelete(session.id);
              }}
              className={cn(
                "group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                activeId === session.id
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted",
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
              <span className="flex-1 truncate">{session.title}</span>
              <Trash2
                className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
              />
            </motion.button>
          ))}
        </div>
      </ScrollArea>
    </motion.aside>
  );
}
