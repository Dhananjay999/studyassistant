import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthCallback() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = Number(params.get("expires_in") || "3600");

    if (accessToken && refreshToken) {
      setSession(accessToken, refreshToken, expiresIn)
        .then(() => navigate("/chat", { replace: true }))
        .catch(() => navigate("/?auth_error=session", { replace: true }));
    } else {
      navigate("/?auth_error=missing_token", { replace: true });
    }
  }, [setSession, navigate]);

  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  );
}
