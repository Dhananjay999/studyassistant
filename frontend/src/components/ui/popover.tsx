import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"
import {
  PopupAnalyticsContext,
  usePopupAnalytics,
  usePopupContentProps,
  usePopupTitle,
  usePopupTriggerProps,
} from "@/hooks/usePopupAnalytics"

type PopoverRootProps = React.ComponentProps<typeof PopoverPrimitive.Root> & {
  /** Analytics name for POPUP_OPENED / POPUP_CLOSED (defaults to the trigger label). */
  analyticsName?: string
}

const Popover = (props: PopoverRootProps) => {
  const { rootProps, handle } = usePopupAnalytics("popover", props)
  return (
    <PopupAnalyticsContext.Provider value={handle}>
      <PopoverPrimitive.Root {...rootProps} />
    </PopupAnalyticsContext.Provider>
  )
}
Popover.displayName = "Popover"

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>((props, ref) => {
  const triggerProps = usePopupTriggerProps(props)
  return <PopoverPrimitive.Trigger ref={ref} {...triggerProps} />
})
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const popupProps = usePopupContentProps(props)
  return (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...popupProps}
    />
  </PopoverPrimitive.Portal>
)
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
