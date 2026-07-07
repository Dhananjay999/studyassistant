import { useEffect } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

// How far a horizontal swipe must travel before it dismisses.
const SWIPE_DISMISS_PX = 60

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  // Native-style dismissal: no visible ✕ (the close button is kept in the DOM
  // but hidden via CSS so we can trigger sonner's own smooth exit
  // programmatically), plus a horizontal swipe in EITHER direction to dismiss.
  // Auto-dismiss after `duration` is unchanged. Touch-only, so desktop is
  // unaffected (it relies on auto-dismiss).
  useEffect(() => {
    let dragging: HTMLElement | null = null
    let startX = 0
    let dx = 0

    const toastFrom = (t: EventTarget | null) =>
      (t as HTMLElement | null)?.closest<HTMLElement>(
        "[data-sonner-toast]",
      ) ?? null

    const onStart = (e: TouchEvent) => {
      const el = toastFrom(e.target)
      // Ignore drags that start on an action/cancel button inside the toast.
      if (!el || (e.target as HTMLElement).closest("button")) return
      dragging = el
      startX = e.touches[0].clientX
      dx = 0
      el.style.transition = "none"
    }

    const onMove = (e: TouchEvent) => {
      if (!dragging) return
      dx = e.touches[0].clientX - startX
      dragging.style.transform = `translateX(${dx}px)`
      dragging.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 200))
    }

    const onEnd = () => {
      if (!dragging) return
      const el = dragging
      dragging = null
      el.style.transition = "transform .2s ease, opacity .2s ease"
      if (Math.abs(dx) > SWIPE_DISMISS_PX) {
        // Slide it off, then let sonner remove it so its state stays in sync.
        el.style.transform = `translateX(${dx > 0 ? 480 : -480}px)`
        el.style.opacity = "0"
        window.setTimeout(() => {
          el.querySelector<HTMLElement>("[data-close-button]")?.click()
        }, 180)
      } else {
        el.style.transform = ""
        el.style.opacity = ""
      }
    }

    document.addEventListener("touchstart", onStart, { passive: true })
    document.addEventListener("touchmove", onMove, { passive: true })
    document.addEventListener("touchend", onEnd)
    return () => {
      document.removeEventListener("touchstart", onStart)
      document.removeEventListener("touchmove", onMove)
      document.removeEventListener("touchend", onEnd)
    }
  }, [])

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Shorter on-screen life and a small stack so multiple toasts queue.
      duration={3000}
      // Kept for programmatic dismissal only — hidden via classNames below.
      closeButton
      visibleToasts={3}
      gap={8}
      // richColors gives success/error/warning/info their own tint + icon,
      // respecting the active light/dark theme.
      richColors
      toastOptions={{
        classNames: {
          toast:
            "group toast rounded-xl border shadow-lg group-[.toaster]:font-sans",
          title: "text-sm font-semibold",
          description: "text-[13px] opacity-90",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // No visible close affordance — dismissal is swipe / auto only.
          closeButton: "hidden",
        },
      }}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Toaster, toast }
