import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GradientText({
  children,
  as: Tag = "span",
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return <Tag className={cn("text-gradient", className)}>{children}</Tag>;
}
