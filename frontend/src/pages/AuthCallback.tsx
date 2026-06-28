import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppLoader } from "@/components/common/AppLoader";
import { AUTH_MESSAGES } from "@/lib/loadingMessages";

export default function AuthCallback() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = Number(params.get("expires_in") || "3600");

    // Popup flow: hand tokens to the opener and close this window.
    const inPopup = !!window.opener && window.opener !== window;
    if (inPopup) {
      if (accessToken && refreshToken) {
        window.opener.postMessage(
          {
            type: "studyassistant-auth",
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn,
          },
          window.location.origin,
        );
      }
      window.close();
      return;
    }

    // Full-redirect fallback flow.
    if (accessToken && refreshToken) {
      setSession(accessToken, refreshToken, expiresIn)
        .then(() => navigate("/chat", { replace: true }))
        .catch(() => navigate("/?auth_error=session", { replace: true }));
    } else {
      navigate("/?auth_error=missing_token", { replace: true });
    }
  }, [setSession, navigate]);

  return <AppLoader aurora messages={AUTH_MESSAGES} />;
}
