// Pro Early Access host. Mounted ONCE in App.tsx for signed-in users. It
// keeps `lib/plan.ts` told who is signed in, watches the value-moment
// counter, opens the introduction at a quiet moment once the threshold is
// reached, records the outcome on the profile (so no device asks twice), and
// reports to analytics. The view is `ProIntroModal`.
//
// It never opens right after login (the counter starts at zero and only
// features add to it), never over another popup, and never again once the
// profile says `pro_prompt_shown`.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { ProIntroModal } from "@/components/pro/ProIntroModal";
import { useAuth } from "@/contexts/AuthContext";
import { useAppConfig } from "@/hooks/api";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  activateProEarlyAccess,
  markProPromptShown,
} from "@/lib/api";
import {
  analytics,
  AnalyticsEvent,
  routeName,
  type ProIntroDismissVia,
} from "@/lib/analytics";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import {
  clearProValuePoints,
  currencyFor,
  getLastProValueMoment,
  getProValuePoints,
  markProPromptShownThisLoad,
  PRO_PROMPT_PERMANENT_BLOCKS,
  proPlan,
  setProPromptUser,
  shouldShowProPrompt,
  subscribeProValuePoints,
} from "@/lib/plan";

// How long after the threshold is crossed we wait before opening, so the
// introduction appears once the feature's own result has settled (the quiz
// score, the answer's last line) rather than on top of it.
const SETTLE_MS = 1_800;
// While the user is busy or another popup is open, try again this often.
const RETRY_MS = 2_000;

const noPoints = () => 0;

export function ProAccessHost() {
  const { user, isAuthenticated, loading, refreshUser } = useAuth();
  const { data: config } = useAppConfig();
  const { pathname } = useLocation();
  const isMobile = useIsMobile();

  const currency = currencyFor(user);
  const [open, setOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedAtRef = useRef(0);
  const viaRef = useRef<ProIntroDismissVia | null>(null);

  const points = useSyncExternalStore(
    subscribeProValuePoints,
    getProValuePoints,
    noPoints,
  );

  // Tell the store who is signed in (null while loading or signed out).
  const userId = !loading && isAuthenticated ? (user?.id ?? null) : null;
  useEffect(() => {
    setProPromptUser(userId);
  }, [userId]);

  // Latest values for timers without re-arming them.
  const envRef = useRef({ user, pathname, isMobile, currency });
  envRef.current = { user, pathname, isMobile, currency };

  // Open once enough value has been delivered, at a quiet moment.
  useEffect(() => {
    if (open || !userId || points <= 0) return undefined;
    const initial = shouldShowProPrompt(envRef.current.user);
    if (
      initial.ok === false &&
      PRO_PROMPT_PERMANENT_BLOCKS.has(initial.reason)
    ) {
      // Dismissed on another device, or already Pro: nothing to count.
      clearProValuePoints();
      return undefined;
    }

    let timer: number | undefined;
    const attempt = () => {
      const decision = shouldShowProPrompt(envRef.current.user);
      if (decision.ok) {
        markProPromptShownThisLoad();
        openedAtRef.current = performance.now();
        setError(null);
        setOpen(true);
        return;
      }
      if (
        decision.ok === false &&
        (decision.reason === "other_popup_open" ||
          decision.reason === "user_busy")
      ) {
        timer = window.setTimeout(attempt, RETRY_MS);
      }
    };
    timer = window.setTimeout(attempt, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [open, userId, points]);

  // Impression.
  useEffect(() => {
    if (!open) return;
    const { pathname: path, isMobile: mobile, currency: cur } = envRef.current;
    analytics.track(AnalyticsEvent.PRO_INTRO_SHOWN, {
      value_points: getProValuePoints(),
      last_moment: getLastProValueMoment() ?? undefined,
      layout: mobile ? "sheet" : "modal",
      page: routeName(path),
      currency: cur,
    });
  }, [open]);

  const sinceOpen = () => Math.round(performance.now() - openedAtRef.current);

  // Closed without activating: remember on the profile and never ask again.
  const dismiss = useCallback(
    (via: ProIntroDismissVia) => {
      setOpen(false);
      analytics.track(AnalyticsEvent.PRO_INTRO_DISMISSED, {
        via,
        duration_ms: sinceOpen(),
      });
      clearProValuePoints();
      // The per-load flag already keeps this visit quiet; the server flag
      // keeps every other device quiet, so it is worth one retry.
      markProPromptShown()
        .catch(() => markProPromptShown())
        .then(() => refreshUser())
        .catch(() => {
          /* best effort */
        });
    },
    [refreshUser],
  );

  const onOpenChange = (next: boolean) => {
    if (next || activating) return;
    const via = viaRef.current ?? (isMobile ? "drag" : "close");
    viaRef.current = null;
    dismiss(via);
  };

  const onActivate = async () => {
    if (activating) return;
    setActivating(true);
    setError(null);
    const t0 = performance.now();
    try {
      const plan = await activateProEarlyAccess(currency);
      analytics.track(AnalyticsEvent.PRO_ACTIVATED, {
        source: "intro",
        plan_status: plan.plan_status,
        currency,
        duration_ms: sinceOpen(),
        latency_ms: Math.round(performance.now() - t0),
      });
      clearProValuePoints();
      setOpen(false);
      await refreshUser();
      toast.success("Pro Early Access is on", {
        description: "Everything in Aeva, free for you. No payment needed.",
      });
    } catch (err) {
      analytics.track(AnalyticsEvent.PRO_ACTIVATION_FAILED, {
        source: "intro",
        error_kind: errorKind(err),
        latency_ms: Math.round(performance.now() - t0),
      });
      setError(friendlyErrorMessage(err));
    } finally {
      setActivating(false);
    }
  };

  if (!userId) return null;

  return (
    <ProIntroModal
      open={open}
      plan={proPlan(config?.plans)}
      currency={currency}
      activating={activating}
      error={error}
      onActivate={onActivate}
      onNotNow={() => dismiss("not_now")}
      onOpenChange={onOpenChange}
      onEscapeKeyDown={() => {
        viaRef.current = "escape";
      }}
      onPointerDownOutside={() => {
        viaRef.current = "outside";
      }}
    />
  );
}
