// A single dashboard metric tile with a loading skeleton.

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/adminFormat";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | null | undefined;
  icon: LucideIcon;
  loading?: boolean;
  hint?: string;
  index?: number;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  loading = false,
  hint,
  index = 0,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
    >
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground">
              {label}
            </p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-16" />
            ) : (
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatNumber(value)}
              </p>
            )}
            {hint && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {hint}
              </p>
            )}
          </div>
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center",
              "rounded-lg bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </Card>
    </motion.div>
  );
}
