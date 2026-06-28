// A modal that is a centered Dialog on desktop and a vaul bottom-sheet on
// mobile. The mobile sheet gets a drag handle, drag-to-dismiss, optional snap
// points, and safe-area padding; the desktop side is the shadcn Dialog. The
// sub-component API mirrors Dialog/Drawer so migrating a call site is mostly
// mechanical: swap the imports and the `*Modal*` names.
//
// Each piece branches on a context flag instead of rendering both trees, so
// only one set of primitives mounts. Title/Description use the matching
// primitive (vaul vs Radix) to keep each library's a11y wiring intact.

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Drawer as DrawerPrimitive } from "vaul"
import { X } from "lucide-react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

const ResponsiveModalContext = React.createContext<{ isMobile: boolean }>({
  isMobile: false,
})

const useResponsiveModalContext = () =>
  React.useContext(ResponsiveModalContext)

interface ResponsiveModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  /** Mobile-only snap points, e.g. `[0.5, 0.9]` or `["25%", "50%", "90%"]`. */
  snapPoints?: (number | string)[]
  /** When false, the sheet can't be dragged/clicked away (use while busy). */
  dismissible?: boolean
}

function ResponsiveModal({
  open,
  onOpenChange,
  children,
  snapPoints,
  dismissible = true,
}: ResponsiveModalProps) {
  const isMobile = useIsMobile()

  return (
    <ResponsiveModalContext.Provider value={{ isMobile }}>
      {isMobile ? (
        <DrawerPrimitive.Root
          open={open}
          onOpenChange={onOpenChange}
          dismissible={dismissible}
          shouldScaleBackground
          snapPoints={snapPoints}
        >
          {children}
        </DrawerPrimitive.Root>
      ) : (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
          {children}
        </DialogPrimitive.Root>
      )}
    </ResponsiveModalContext.Provider>
  )
}
ResponsiveModal.displayName = "ResponsiveModal"

const ResponsiveModalTrigger = (
  props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>,
) => {
  const { isMobile } = useResponsiveModalContext()
  const Trigger = isMobile ? DrawerPrimitive.Trigger : DialogPrimitive.Trigger
  return <Trigger {...props} />
}

const ResponsiveModalClose = (
  props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>,
) => {
  const { isMobile } = useResponsiveModalContext()
  const Close = isMobile ? DrawerPrimitive.Close : DialogPrimitive.Close
  return <Close {...props} />
}

interface ResponsiveModalContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Show the desktop close (X) button. Ignored on mobile (drag to dismiss). */
  showClose?: boolean
}

const ResponsiveModalContent = React.forwardRef<
  HTMLDivElement,
  ResponsiveModalContentProps
>(({ className, children, showClose = true, ...props }, ref) => {
  const { isMobile } = useResponsiveModalContext()

  if (isMobile) {
    return (
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          ref={ref}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[94vh] flex-col gap-3 rounded-t-2xl border border-border/50 bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] outline-none",
            className,
          )}
          {...props}
        >
          <div
            aria-hidden
            className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30"
          />
          {children}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    )
  }

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 flex max-h-[90vh] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
ResponsiveModalContent.displayName = "ResponsiveModalContent"

const ResponsiveModalHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const { isMobile } = useResponsiveModalContext()
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 text-center sm:text-left",
        isMobile && "pt-3",
        className,
      )}
      {...props}
    />
  )
}
ResponsiveModalHeader.displayName = "ResponsiveModalHeader"

const ResponsiveModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const { isMobile } = useResponsiveModalContext()
  return (
    <div
      className={cn(
        isMobile
          ? "mt-auto flex flex-col gap-2 pt-3"
          : "flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2",
        className,
      )}
      {...props}
    />
  )
}
ResponsiveModalFooter.displayName = "ResponsiveModalFooter"

const ResponsiveModalTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }
>(({ className, ...props }, ref) => {
  const { isMobile } = useResponsiveModalContext()
  const Title = isMobile ? DrawerPrimitive.Title : DialogPrimitive.Title
  return (
    <Title
      ref={ref}
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  )
})
ResponsiveModalTitle.displayName = "ResponsiveModalTitle"

const ResponsiveModalDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }
>(({ className, ...props }, ref) => {
  const { isMobile } = useResponsiveModalContext()
  const Description = isMobile
    ? DrawerPrimitive.Description
    : DialogPrimitive.Description
  return (
    <Description
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
})
ResponsiveModalDescription.displayName = "ResponsiveModalDescription"

/** Scrollable body wrapper; negative margins let it use the content's gutters
 * while keeping the scrollbar at the sheet edge. Pass `className` to tune. */
const ResponsiveModalBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex-1 overflow-y-auto", className)} {...props} />
)
ResponsiveModalBody.displayName = "ResponsiveModalBody"

export {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalClose,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalFooter,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalBody,
}
