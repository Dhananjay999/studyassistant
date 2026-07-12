// Material-style touch ripple, attached ONCE at startup via event delegation.
// On touch (never mouse — desktop keeps its hover language) a soft ripple
// expands from the exact touch point on any tappable element: buttons, menu
// items, tabs, links, and anything opting in with `data-ripple`. Opt out with
// `data-no-ripple`. Styles live in index.css (.touch-ripple).

const TAPPABLE =
  "button, [role='button'], [role='menuitem'], [role='menuitemradio']," +
  " [role='menuitemcheckbox'], [role='tab'], [role='option']," +
  " [role='radio'], [role='switch'], a[href], summary, [data-ripple]";

const RIPPLE_MS = 450;

function reducedMotion(): boolean {
  return (
    document.documentElement.classList.contains("reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function spawnRipple(host: HTMLElement, x: number, y: number): void {
  const rect = host.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  // The ripple radius must cover the farthest corner from the touch point.
  const dx = Math.max(x - rect.left, rect.right - x);
  const dy = Math.max(y - rect.top, rect.bottom - y);
  const radius = Math.hypot(dx, dy);

  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }

  const container = document.createElement("span");
  container.className = "touch-ripple";
  container.setAttribute("aria-hidden", "true");

  const wave = document.createElement("span");
  wave.style.width = wave.style.height = `${radius * 2}px`;
  wave.style.left = `${x - rect.left - radius}px`;
  wave.style.top = `${y - rect.top - radius}px`;
  container.appendChild(wave);
  host.appendChild(container);

  window.setTimeout(() => container.remove(), RIPPLE_MS + 50);
}

/** Install the delegated touch-ripple listener (idempotent). */
export function attachGlobalRipple(): void {
  const w = window as Window & { __rippleAttached?: boolean };
  if (w.__rippleAttached) return;
  w.__rippleAttached = true;

  document.addEventListener(
    "pointerdown",
    (e: PointerEvent) => {
      // Touch/pen only: hover-capable pointers keep their existing feedback.
      if (e.pointerType === "mouse" || reducedMotion()) return;
      const origin = e.target as HTMLElement | null;
      const host = origin?.closest?.(TAPPABLE) as HTMLElement | null;
      if (
        !host ||
        host.closest("[data-no-ripple]") ||
        host.hasAttribute("disabled") ||
        host.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }
      spawnRipple(host, e.clientX, e.clientY);
    },
    { passive: true, capture: true },
  );
}
