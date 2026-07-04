import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/components/layout/HeaderSlot";

/**
 * Scroll container for a routed page inside {@link AppLayout}. Publishes the page
 * title into the persistent header and owns vertical scroll + the mobile
 * bottom-nav inset — the responsibilities the old per-page `AppShell` used to
 * provide. The header and sidebar are rendered once by the layout, not here.
 */
export function PageContainer({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  usePageTitle(title);
  return (
    <div
      className={cn(
        "h-full overflow-y-auto pb-bottomnav lg:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
