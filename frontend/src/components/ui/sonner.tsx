import { useEffect } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  // Tap-to-dismiss: sonner has no built-in "tap the toast body to close", so we
  // delegate a click on any toast to its (enabled) close button. Taps on the
  // action/cancel/close buttons are left alone — they handle themselves.
  // (Swipe-to-dismiss and the smooth exit animation are built into sonner.)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const toastEl = target.closest("[data-sonner-toast]")
      if (!toastEl || target.closest("button")) return
      toastEl.querySelector<HTMLElement>("[data-close-button]")?.click()
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Shorter on-screen life, an always-available close affordance, and a
      // small stack so multiple toasts queue instead of overlapping.
      duration={3000}
      closeButton
      visibleToasts={3}
      gap={8}
      // richColors gives success/error/warning/info their own green/red/
      // orange/blue treatment (with matching icons) that also respects the
      // active light/dark theme.
      richColors
      toastOptions={{
        classNames: {
          // Shared layout only — colors come from richColors per type so we
          // don't override the type tint with a flat background here.
          toast:
            "group toast rounded-xl border shadow-lg group-[.toaster]:font-sans group-[.toaster]:cursor-pointer",
          title: "text-sm font-semibold",
          description: "text-[13px] opacity-90",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
