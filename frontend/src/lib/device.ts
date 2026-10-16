// Device capability checks shared by components that behave differently on
// phones and tablets. SSR-safe: everything answers "no" without a window.

/** True on a device without a fine pointer (phones, tablets). */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(hover: none), (pointer: coarse)").matches;
  } catch {
    return false;
  }
}
