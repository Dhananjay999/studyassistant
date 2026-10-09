import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { noteLandingLogin } from "@/lib/analytics/landing";
import { AppLoader } from "@/components/common/AppLoader";
import { Seo } from "@/components/common/Seo";
import { AUTH_MESSAGES } from "@/lib/loadingMessages";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { apiErrorStatus } from "@/lib/api";
import { errorKind } from "@/lib/errorMessage";
import { hasExamPlanHint } from "@/lib/examPrepHome";
import { consumeRedirectStart } from "@/lib/signInRedirect";

// Failure reasons the backend callback can send. The value comes from the
// URL, so anything else is reported as "unknown" rather than passed through.
const BACKEND_REASONS = [
  "missing_code",
  "exchange_failed",
  "access_denied",
  "provider_error",
];

function readAuthError(): string | null {
  const raw = new URLSearchParams(window.location.search).get("auth_error");
  if (!raw) return null;
  return BACKEND_REASONS.includes(raw) ? raw : "unknown";
}

export default function AuthCallback() {
  const { setSession, reportSignInIssue } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = Number(params.get("expires_in") || "3600");
    const hasTokens = !!accessToken && !!refreshToken;
    const authError = readAuthError();
    const failure = authError ?? "missing_token";

    // Popup flow: hand the tokens (or the failure reason) to the opener and
    // close this window. The opener tracks the failure and tells the user.
    const inPopup = !!window.opener && window.opener !== window;

    // The backend's side of the sign-in is done: say so before anything can
    // fail on this side, so backend and frontend outcomes reconcile.
    const redirectStartedAt = consumeRedirectStart();
    analytics.track(AnalyticsEvent.LOGIN_CALLBACK_LOADED, {
      has_tokens: hasTokens,
      in_popup: inPopup,
      auth_error: authError ?? undefined,
      elapsed_ms:
        redirectStartedAt === null
          ? undefined
          : Math.max(0, Date.now() - redirectStartedAt),
    });
    if (inPopup) {
      window.opener.postMessage(
        hasTokens
          ? {
              type: "studyassistant-auth",
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_in: expiresIn,
            }
          : { type: "studyassistant-auth", error: failure },
        window.location.origin,
      );
      window.close();
      return;
    }

    // Same-tab flow. A failure here owns its outcome: the session (if any)
    // was already dropped quietly by `setSession`, and the landing page
    // shows the issue dialog, which must survive the navigation (no hard
    // reload on this path).
    const fail = (reason: string, err?: unknown) => {
      noteLandingLogin("failed");
      analytics.track(AnalyticsEvent.LOGIN_FAILED, {
        reason,
        method: "redirect",
        status: apiErrorStatus(err),
        error_kind: err === undefined ? undefined : errorKind(err),
      });
      reportSignInIssue({ kind: "failed", reason });
      navigate(`/?auth_error=${reason}`, { replace: true });
    };

    // A browser that remembers an active exam plan lands on "/", where
    // HomeRoute picks /exam or /chat once the feature flag is known (see
    // lib/examPrepHome.ts); everyone else goes straight to /chat as before.
    if (hasTokens) {
      setSession(accessToken, refreshToken, expiresIn)
        .then(() =>
          navigate(hasExamPlanHint(undefined) ? "/" : "/chat", {
            replace: true,
          }),
        )
        .catch((err: unknown) => fail("session", err));
    } else {
      fail(failure);
    }
  }, [setSession, reportSignInIssue, navigate]);

  return (
    <>
      <Seo title="Signing you in — StudyAssistant" noindex path="/auth/callback" />
      <AppLoader aurora messages={AUTH_MESSAGES} />
    </>
  );
}
