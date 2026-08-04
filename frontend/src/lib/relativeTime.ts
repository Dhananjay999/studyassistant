// Human "studied when" phrasing shared by the Continue Learning rail, the
// revision dashboard, and the welcome screen — one place so "yesterday"
// always means the same thing.

/** "today" / "yesterday" / "3d ago" / "12 Jul" from an ISO timestamp. */
export function lastStudied(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** "due today" / "3d overdue" / "due 12 Jul" from an ISO due date. */
export function dueLabel(iso: string | null, overdueDays: number): string {
  if (!iso) return "";
  if (overdueDays === 1) return "1d overdue";
  if (overdueDays > 1) return `${overdueDays}d overdue`;
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "due today";
  return `due ${new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}
