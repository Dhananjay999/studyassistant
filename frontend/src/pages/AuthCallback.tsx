import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { noteLandingLogin } from "@/lib/analytics/landing";
import { AppLoader } from "@/components/common/AppLoader";
import { Seo } from "@/components/common/Seo";
import { AUTH_MESSAGES } from "@/lib/loadingMessages";
import { analytics, AnalyticsEvent } from "@/lib/analytics";

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
    const failure = readAuthError() ?? "missing_token";

    // Popup flow: hand the tokens (or the failure reason) to the opener and
    // close this window. The opener tracks the failure and tells the user.
    const inPopup = !!window.opener && window.opener !== window;
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

    // Full-redirect fallback flow.
    const fail = (reason: string) => {
      noteLandingLogin("failed");
      analytics.track(AnalyticsEvent.LOGIN_FAILED, {
        reason,
        method: "redirect",
      });
      reportSignInIssue({ kind: "failed", reason });
      navigate(`/?auth_error=${reason}`, { replace: true });
    };

    if (hasTokens) {
      setSession(accessToken, refreshToken, expiresIn)
        .then(() => navigate("/chat", { replace: true }))
        .catch(() => fail("session"));
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
