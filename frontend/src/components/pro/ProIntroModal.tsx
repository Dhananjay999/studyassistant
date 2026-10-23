// The Pro introduction: Aeva is Pro-level, here is what it will cost, and
// today it is ₹0 with no payment. Desktop: a compact centered card. Mobile: a
// bottom sheet with a drag handle (ResponsiveModal). Opening, closing and
// the activation call are owned by `ProAccessHost`; this is the view.

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatPrice, pricesFor } from "@/lib/plan";
import { cn } from "@/lib/utils";
import type { PlanCatalogEntry, PlanCurrency } from "@/types";

const PERKS = [
  "Chat with your notes, PDFs and photos",
  "Unlimited AI quizzes and flashcards",
  "Exam Prep plans and revision",
] as const;

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } },
};
const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
  },
};
const pop: Variants = {
  hidden: { opacity: 0, scale: 0.7 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 380, damping: 22 },
  },
};

export interface ProIntroModalProps {
  open: boolean;
  plan: PlanCatalogEntry;
  /** INR for India, USD elsewhere (`currencyFor` in `lib/plan.ts`). */
  currency: PlanCurrency;
  activating: boolean;
  error: string | null;
  onActivate: () => void;
  onNotNow: () => void;
  /** Close by X / drag / Escape / outside tap. */
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown?: () => void;
  onPointerDownOutside?: () => void;
}

export function ProIntroModal({
  open,
  plan,
  currency,
  activating,
  error,
  onActivate,
  onNotNow,
  onOpenChange,
  onEscapeKeyDown,
  onPointerDownOutside,
}: ProIntroModalProps) {
  const isMobile = useIsMobile();
  const reduce = useReducedMotion();
  const { monthly, yearly } = pricesFor(plan, currency);
  const today = formatPrice(plan.current_amount, currency);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!activating}
      analyticsName="Pro early access"
    >
      <ResponsiveModalContent
        data-analytics-section="pro_intro"
        onEscapeKeyDown={onEscapeKeyDown}
        onPointerDownOutside={onPointerDownOutside}
        className={cn(
          "overflow-hidden",
          !isMobile &&
            "gap-0 rounded-3xl border-border/60 p-0 shadow-glow-lg sm:max-w-[400px] sm:rounded-3xl",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-brand-gradient opacity-20 blur-3xl"
        />
        <ResponsiveModalBody
          className={cn(
            "relative",
            isMobile ? "px-2 pb-2 pt-3" : "px-7 pb-7 pt-9",
          )}
        >
          <motion.div
            variants={stagger}
            initial={reduce ? false : "hidden"}
            animate="show"
            className="flex flex-col items-center text-center"
          >
            <motion.span
              variants={pop}
              className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow"
            >
              <Sparkles className="h-7 w-7" aria-hidden />
            </motion.span>

            <motion.div variants={rise} className="mt-4">
              <ResponsiveModalTitle className="font-display text-xl font-bold tracking-tight">
                {plan.label}
              </ResponsiveModalTitle>
              <ResponsiveModalDescription className="mt-1.5 text-balance">
                You already use the Pro-level Aeva. It stays free for you
                during Early Access.
              </ResponsiveModalDescription>
            </motion.div>

            {/* Prices: what Pro will cost, struck through, next to today. */}
            <motion.div
              variants={rise}
              className="mt-5 w-full rounded-2xl border border-border/60 bg-card/60 p-4"
            >
              <div className="flex items-end justify-center gap-2">
                <span className="font-display text-4xl font-bold leading-none tracking-tight">
                  {today}
                </span>
                <span className="pb-1 text-sm text-muted-foreground">
                  today
                </span>
              </div>
              <p className="mt-1.5 text-xs font-medium text-brand-1">
                Currently free during Early Access · No payment required
              </p>
              {(monthly || yearly) && (
                <dl className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {monthly && (
                    <div className="flex items-center gap-1.5">
                      <dt>Monthly</dt>
                      <dd className="line-through decoration-muted-foreground/60">
                        {formatPrice(monthly.amount, currency)}
                      </dd>
                    </div>
                  )}
                  {yearly && (
                    <div className="flex items-center gap-1.5">
                      <dt>Yearly</dt>
                      <dd className="line-through decoration-muted-foreground/60">
                        {formatPrice(yearly.amount, currency)}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </motion.div>

            <motion.ul
              variants={rise}
              className="mt-4 w-full space-y-1.5 text-left text-sm"
            >
              {PERKS.map((perk) => (
                <li key={perk} className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-1"
                    aria-hidden
                  />
                  <span className="min-w-0">{perk}</span>
                </li>
              ))}
            </motion.ul>

            <motion.div variants={rise} className="mt-5 w-full space-y-2">
              <Button
                variant="brand"
                size="lg"
                className="h-12 w-full rounded-xl text-base"
                onClick={onActivate}
                disabled={activating}
                data-analytics-name="Activate Pro"
              >
                {activating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden />
                )}
                Activate Pro — {today}
              </Button>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <Button
                variant="ghost"
                className="h-11 w-full text-muted-foreground"
                onClick={onNotNow}
                disabled={activating}
                data-analytics-name="Not now"
              >
                Not now
              </Button>
            </motion.div>
          </motion.div>
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
