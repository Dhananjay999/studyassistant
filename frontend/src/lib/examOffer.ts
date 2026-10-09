// Client side of the exam-soon offer (see backend `orchestration/exam_offer`):
// resolving the date hint on the device's clock, and the little per-device
// memory that keeps the card from nagging.
//
// The server sends a hint ("tomorrow", a weekday, a day and month), never a
// calendar date: it runs in UTC and "tomorrow" is the student's local day.

import { isoToday, parsePlanDate } from "@/components/exam/examFormat";
import type { ExamPrepOffer } from "@/types";

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function addDays(iso: string, days: number): string {
  const d = parsePlanDate(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** A real calendar date (no 31 February rolling into March), or null. */
function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
    ? d
    : null;
}

/**
 * The exam date the offer points at, as `yyyy-mm-dd` in the device's
 * timezone. Falls back to tomorrow whenever the hint cannot be resolved, so
 * the card always opens with a usable date.
 */
export function resolveOfferDate(
  offer: ExamPrepOffer,
  today: string = isoToday(),
): string {
  const tomorrow = addDays(today, 1);
  const now = parsePlanDate(today);
  if (offer.days_ahead !== null && offer.days_ahead >= 0) {
    return addDays(today, offer.days_ahead);
  }
  if (offer.date_hint === "weekday" && offer.weekday !== null) {
    // Backend weekdays are Monday = 0; JS getDay() is Sunday = 0. A named
    // weekday is the next one, and the same weekday is a week away.
    const todayIdx = (now.getDay() + 6) % 7;
    const ahead = ((offer.weekday - todayIdx - 1 + 7) % 7) + 1;
    return addDays(today, ahead);
  }
  if (offer.date_hint === "date" && offer.day !== null) {
    if (offer.month === null) {
      // "on the 15th": this month if still ahead, else next month.
      for (const add of [0, 1]) {
        const base = new Date(now.getFullYear(), now.getMonth() + add, 1);
        const d = validDate(base.getFullYear(), base.getMonth() + 1, offer.day);
        if (d && d.getTime() >= now.getTime()) return toIso(d);
      }
      return tomorrow;
    }
    const years = offer.year
      ? [offer.year]
      : [now.getFullYear(), now.getFullYear() + 1];
    for (const year of years) {
      const d = validDate(year, offer.month, offer.day);
      if (d && d.getTime() >= now.getTime()) return toIso(d);
    }
  }
  return tomorrow;
}

/** Whole days from today to `iso` (negative when it has passed). */
export function daysUntil(iso: string, today: string = isoToday()): number {
  return Math.round(
    (parsePlanDate(iso).getTime() - parsePlanDate(today).getTime()) / DAY_MS,
  );
}

/* ------------------------------ device memory ----------------------------- */

// One small record per browser profile. "Not now" snoozes every offer for a
// while (the student said no; the next mention of the exam must not bring the
// card straight back), and each offer reports its impression once.
export const EXAM_OFFER_STORAGE_KEY = "aeva.examPrepOffer.v1";
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const SEEN_MAX = 40;

interface OfferMemory {
  snoozedUntil?: number;
  seen?: string[];
}

function read(): OfferMemory {
  try {
    const raw = window.localStorage.getItem(EXAM_OFFER_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as OfferMemory) : {};
  } catch {
    return {};
  }
}

function write(memory: OfferMemory): void {
  try {
    window.localStorage.setItem(EXAM_OFFER_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Storage unavailable (private mode): the card simply is not remembered.
  }
}

/** True while a "Not now" is still in effect on this device. */
export function isOfferSnoozed(now: number = Date.now()): boolean {
  const until = read().snoozedUntil;
  return typeof until === "number" && until > now;
}

/** Remember "Not now": no offer cards for the next 24 hours. */
export function snoozeOffers(now: number = Date.now()): void {
  write({ ...read(), snoozedUntil: now + SNOOZE_MS });
}

/**
 * Record the impression of the offer on `messageId`. Returns true the first
 * time only, so reopening the conversation does not count it again.
 */
export function markOfferSeen(messageId: string): boolean {
  const memory = read();
  const seen = Array.isArray(memory.seen) ? memory.seen : [];
  if (seen.includes(messageId)) return false;
  write({ ...memory, seen: [...seen, messageId].slice(-SEEN_MAX) });
  return true;
}
