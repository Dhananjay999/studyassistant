// The Plan card in Account settings (desktop Settings modal and the mobile
// Profile → Account page). On the free plan it offers the same ₹0 Early
// Access activation as the introduction, so a user who tapped "Not now" can
// still opt in; once on Pro it shows the ✨ Pro · Early Access status and
// when it was activated. Prices come from `/config.plans`, the same source
// the introduction uses.

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProStatusChip } from "@/components/pro/ProStatusChip";
import { useAuth } from "@/contexts/AuthContext";
import { useAppConfig } from "@/hooks/api";
import { activateProEarlyAccess } from "@/lib/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import {
  currencyFor,
  formatPrice,
  hasProAccess,
  pricesFor,
  proPlan,
} from "@/lib/plan";

export function ProPlanCard() {
  const { user, refreshUser } = useAuth();
  const { data: config } = useAppConfig();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = proPlan(config?.plans);
  const currency = currencyFor(user);
  const { monthly, yearly } = pricesFor(plan, currency);
  const today = formatPrice(plan.current_amount, currency);
  const isPro = hasProAccess(user);

  const activate = async () => {
    if (activating) return;
    setActivating(true);
    setError(null);
    const t0 = performance.now();
    try {
      const next = await activateProEarlyAccess(currency);
      analytics.track(AnalyticsEvent.PRO_ACTIVATED, {
        source: "profile",
        plan_status: next.plan_status,
        currency,
        duration_ms: 0,
        latency_ms: Math.round(performance.now() - t0),
      });
      await refreshUser();
      toast.success("Pro Early Access is on", {
        description: "Everything in Aeva, free for you. No payment needed.",
      });
    } catch (err) {
      analytics.track(AnalyticsEvent.PRO_ACTIVATION_FAILED, {
        source: "profile",
        error_kind: errorKind(err),
        latency_ms: Math.round(performance.now() - t0),
      });
      setError(friendlyErrorMessage(err));
    } finally {
      setActivating(false);
    }
  };

  const activatedOn = user?.pro_activated_at
    ? new Date(user.pro_activated_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          {plan.label}
          {isPro && <ProStatusChip />}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isPro
            ? `Free for you during Early Access. No payment required.${
                activatedOn ? ` Activated ${activatedOn}.` : ""
              }`
            : `${today} during Early Access, no payment required.`}
        </p>
        {!isPro && (monthly || yearly) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Later:
            {monthly && ` ${formatPrice(monthly.amount, currency)}/month`}
            {monthly && yearly && " ·"}
            {yearly && ` ${formatPrice(yearly.amount, currency)}/year`}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {!isPro && (
        <Button
          variant="brand"
          size="sm"
          className="h-11 shrink-0 gap-1.5 rounded-lg sm:h-9"
          onClick={activate}
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
      )}
    </div>
  );
}
