// Small formatting helpers shared across admin views.

export function formatBytes(bytes: number | null | undefined): string {
  const n = bytes ?? 0;
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(n) / Math.log(1024)),
    units.length - 1,
  );
  const value = n / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatNumber(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short label for an IANA timezone: "Asia/Kolkata" at today's date → "IST". */
export function zoneLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    // Zones without a short name come back as "GMT+5:30"; keep the zone's city then.
    if (part && !/^GMT[+-]/.test(part.value)) return part.value;
  } catch {
    // Unknown zone name: fall through to the raw name.
  }
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}
