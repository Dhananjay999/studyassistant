import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // richColors gives success/error/warning/info their own green/red/
      // orange/blue treatment (with matching icons) that also respects the
      // active light/dark theme. closeButton adds an explicit dismiss.
      richColors
      toastOptions={{
        classNames: {
          // Shared layout only — colors come from richColors per type so we
          // don't override the type tint with a flat background here.
          toast:
            "group toast rounded-xl border shadow-lg group-[.toaster]:font-sans",
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
