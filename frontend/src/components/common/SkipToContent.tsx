/**
 * Keyboard-accessibility skip link. Visually hidden until focused; jumps past
 * the fixed navbar straight to the page's <main id="main">.
 */
export function SkipToContent() {
  return (
    <a
      href="#main"
      className="sr-only z-[60] rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >
      Skip to content
    </a>
  );
}
