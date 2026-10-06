// Exam Prep as the primary screen. A student who has an active exam plan
// lands on /exam after login instead of /chat (the brief: Exam Prep is the
// primary experience when the student came for exam preparation). The
// decision must be synchronous at boot, so the dashboard query records a
// small hint in localStorage and HomeRoute reads it without a network wait.
//
// Only consulted when the `exam_prep` feature flag is on; brand-new users
// (no hint) keep the /chat home, where onboarding lives.

export const EXAM_PLAN_HINT_KEY = "aeva.examPrep.hasPlan.v1";

function read(): string | null {
  try {
    return window.localStorage.getItem(EXAM_PLAN_HINT_KEY);
  } catch {
    return null;
  }
}

/** True when this browser last saw an active exam plan for `userId`
 * (or for any account when `userId` is unknown, e.g. mid-login). */
export function hasExamPlanHint(userId?: string | null): boolean {
  const stored = read();
  if (!stored) return false;
  return !userId || stored === userId;
}

/** Record whether `userId` currently has an active plan. */
export function setExamPlanHint(userId: string, has: boolean): void {
  try {
    if (has) window.localStorage.setItem(EXAM_PLAN_HINT_KEY, userId);
    else if (read() === userId)
      window.localStorage.removeItem(EXAM_PLAN_HINT_KEY);
  } catch {
    // Storage unavailable (private mode): the home stays /chat.
  }
}

/** Where an authenticated user should land. */
export function homePathFor(
  examPrepEnabled: boolean,
  userId?: string | null,
): "/exam" | "/chat" {
  return examPrepEnabled && hasExamPlanHint(userId) ? "/exam" : "/chat";
}
