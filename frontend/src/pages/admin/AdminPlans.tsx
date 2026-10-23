// Plans & Pricing: edit what Aeva Pro costs. The catalog (tiers, currencies,
// code defaults) lives in backend code; this view shows it merged with the
// admin override and saves a new override per plan. The user app reads the
// result from GET /config (popup, Account card) and the assistant quotes it
// in product answers; changes propagate within about a minute.

import { useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useAdminPlans, useResetPlan, useSetPlan } from "@/hooks/adminApi";
import { formatDate } from "@/lib/adminFormat";
import type {
  AdminPlan,
  AdminPlanOverride,
  AdminPlanPrice,
} from "@/types/admin";

const CURRENCIES: ReadonlyArray<{
  code: AdminPlanPrice["currency"];
  label: string;
  symbol: string;
}> = [
  { code: "INR", label: "India", symbol: "₹" },
  { code: "USD", label: "Rest of the world", symbol: "$" },
];
const INTERVALS: ReadonlyArray<{
  code: AdminPlanPrice["interval"];
  label: string;
}> = [
  { code: "month", label: "Monthly" },
  { code: "year", label: "Yearly" },
];

/** Form state: one text field per (currency, interval), kept as strings so
 *  a half-typed "4." does not snap back to a number under the cursor. */
type Draft = {
  prices: Record<string, string>;
  current_amount: string;
  early_access: boolean;
};

const cellKey = (currency: string, interval: string) =>
  `${currency}:${interval}`;

function toDraft(plan: AdminPlanOverride): Draft {
  const prices: Record<string, string> = {};
  for (const p of plan.prices) prices[cellKey(p.currency, p.interval)] = String(p.amount);
  return {
    prices,
    current_amount: String(plan.current_amount),
    early_access: plan.early_access,
  };
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  // Two decimals at most (minor units).
  return Math.round(n * 100) / 100;
}

/** Draft → override body, or an error message for the first bad field. */
function fromDraft(draft: Draft): { body: AdminPlanOverride } | { error: string } {
  const prices: AdminPlanPrice[] = [];
  for (const c of CURRENCIES) {
    for (const i of INTERVALS) {
      const raw = draft.prices[cellKey(c.code, i.code)] ?? "";
      if (raw.trim() === "") continue; // an interval may be left unpriced
      const amount = parseAmount(raw);
      if (amount === null) {
        return { error: `${c.label} ${i.label.toLowerCase()} price must be a number ≥ 0` };
      }
      prices.push({ interval: i.code, currency: c.code, amount });
    }
  }
  if (prices.length === 0) return { error: "Set at least one price" };
  const current = parseAmount(draft.current_amount);
  if (current === null) return { error: "Today's price must be a number ≥ 0" };
  return { body: { prices, current_amount: current, early_access: draft.early_access } };
}

export function AdminPlans() {
  const { data, isLoading } = useAdminPlans();
  const plans = (data?.plans ?? []).filter((p) => p.key !== "free");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">
          Plans &amp; Pricing
        </h1>
      </div>

      <p className="max-w-2xl text-sm text-muted-foreground">
        What the Pro introduction and the Account page show, and what the
        assistant quotes when asked about pricing. Users in India see INR,
        everyone else USD. Early Access keeps today&apos;s price at 0 and the
        &ldquo;Activate Pro&rdquo; flow free; nothing is charged by the app
        either way. Changes reach users within about a minute.
      </p>

      {isLoading ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plans registered.</p>
      ) : (
        plans.map((plan) => <PlanEditor key={plan.key} plan={plan} />)
      )}
    </div>
  );
}

function PlanEditor({ plan }: { plan: AdminPlan }) {
  const setPlan = useSetPlan();
  const resetPlan = useResetPlan();
  const [draft, setDraft] = useState<Draft>(() => toDraft(plan));
  const [confirmReset, setConfirmReset] = useState(false);

  // A save or reset changes the server copy; follow it.
  useEffect(() => {
    setDraft(toDraft(plan));
  }, [plan]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(toDraft(plan)),
    [draft, plan],
  );
  const overridden = plan.updated_at !== null;
  const busy = setPlan.isPending || resetPlan.isPending;

  const setPrice = (key: string, value: string) =>
    setDraft((d) => ({ ...d, prices: { ...d.prices, [key]: value } }));

  const save = () => {
    const parsed = fromDraft(draft);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    setPlan.mutate(
      { key: plan.key, body: parsed.body },
      {
        onSuccess: () => toast.success(`${plan.label} pricing saved`),
        onError: () => toast.error("Couldn't save the plan"),
      },
    );
  };

  const reset = () => {
    setConfirmReset(false);
    resetPlan.mutate(plan.key, {
      onSuccess: () => toast.success(`${plan.label} back to code defaults`),
      onError: () => toast.error("Couldn't reset the plan"),
    });
  };

  return (
    <section className="space-y-5 rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{plan.label}</h2>
        <Badge variant="outline" className="font-mono text-[10px]">
          {plan.key}
        </Badge>
        {draft.early_access && (
          <Badge variant="secondary">Early Access</Badge>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground/70">
          {overridden
            ? `Updated ${formatDate(plan.updated_at as string)}${
                plan.updated_by ? ` by ${plan.updated_by}` : ""
              }`
            : "Code default"}
        </span>
      </div>

      {/* One column per currency, monthly and yearly in each. Stacks on
         phones so inputs stay full-width and tappable. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {CURRENCIES.map((c) => (
          <fieldset key={c.code} className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {c.label} · {c.code}
            </legend>
            {INTERVALS.map((i) => {
              const key = cellKey(c.code, i.code);
              const def = plan.default.prices.find(
                (p) => p.currency === c.code && p.interval === i.code,
              );
              return (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`${plan.key}-${key}`} className="text-xs">
                    {i.label}
                    {def && (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        (default {c.symbol}
                        {def.amount})
                      </span>
                    )}
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                      {c.symbol}
                    </span>
                    <Input
                      id={`${plan.key}-${key}`}
                      inputMode="decimal"
                      value={draft.prices[key] ?? ""}
                      onChange={(e) => setPrice(key, e.target.value)}
                      placeholder="—"
                      className="h-11 pl-7"
                      disabled={busy}
                    />
                  </div>
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${plan.key}-today`} className="text-xs">
            Price today
            <span className="ml-1.5 font-normal text-muted-foreground">
              (shown as &ldquo;₹0 / $0 today&rdquo; while 0)
            </span>
          </Label>
          <Input
            id={`${plan.key}-today`}
            inputMode="decimal"
            value={draft.current_amount}
            onChange={(e) =>
              setDraft((d) => ({ ...d, current_amount: e.target.value }))
            }
            className="h-11"
            disabled={busy}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">Early Access</p>
            <p className="text-xs text-muted-foreground">
              Free activation and &ldquo;Currently free&rdquo; copy. Off
              means the prices above are what users are told they pay.
            </p>
          </div>
          <Switch
            checked={draft.early_access}
            aria-label="Toggle Early Access"
            disabled={busy}
            onCheckedChange={(v) =>
              setDraft((d) => ({ ...d, early_access: v }))
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {overridden && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 gap-1.5 sm:h-9"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw className="h-4 w-4" />
            Reset to defaults
          </Button>
        )}
        <Button
          size="sm"
          className="h-11 min-w-28 sm:h-9"
          disabled={!dirty || busy}
          onClick={save}
        >
          {setPlan.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Save pricing"
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Reset ${plan.label} pricing?`}
        description="The saved prices are removed and the plan returns to the values in code. Users see the change within about a minute."
        confirmText="Reset"
        destructive={false}
        onConfirm={reset}
      />
    </section>
  );
}
