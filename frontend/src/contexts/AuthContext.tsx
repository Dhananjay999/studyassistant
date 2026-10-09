import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  API_BASE_URL,
  ENDPOINTS,
  apiErrorStatus,
  getLearningProfile,
  getMe,
  refreshSession,
  setTokenGetter,
  setUnauthorizedHandler,
} from "@/lib/api";
import { errorKind } from "@/lib/errorMessage";
import { queryClient } from "@/lib/queryClient";
import { noteLandingLogin } from "@/lib/analytics/landing";
import {
  consumeRedirectStart,
  markRedirectStarted,
} from "@/lib/signInRedirect";
import { qk } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { setSentryUser } from "@/lib/sentry";
import type { User } from "@/types";

type LoadReason = "boot" | "login" | "refresh";
type LoginMethod = "popup" | "redirect";

export interface SignInIssue {
  /** `abandoned`: the popup closed before finishing; `failed`: an error. */
  kind: "abandoned" | "failed";
  reason?: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  /** Developer Mode: true only for admin-flagged debug users. The single
   * switch every debug-only UI must check — normal users never see debug
   * information. */
  isDebugUser: boolean;
  loading: boolean;
  signingIn: boolean;
  /** How the in-flight sign-in runs: `redirect` while this tab is leaving
   * for Google, `popup` while a popup is open; null when idle. */
  signingInMethod: LoginMethod | null;
  /** True when `signInWithGoogle` would open a popup on this device (the
   * opt-in desktop mode); false when it signs in within this tab. */
  popupSignIn: boolean;
  /** Why the last sign-in attempt ended without a session (shown by
   * `SigningInModal`); null once dismissed or when a new attempt starts. */
  signInIssue: SignInIssue | null;
  signInWithGoogle: () => void;
  /** Same sign-in as a full-page redirect — the way out when the popup
   * keeps failing. */
  signInWithRedirect: () => void;
  /** Stop waiting on an open sign-in popup (the dialog's Cancel button). */
  cancelSignIn: () => void;
  reportSignInIssue: (issue: SignInIssue) => void;
  dismissSignInIssue: () => void;
  setSession: (
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AUTH_MESSAGE = "studyassistant-auth";

const STORAGE = {
  access: "aeva_access_token",
  refresh: "aeva_refresh_token",
  expires: "aeva_expires_at",
};

// Per-user device state (pinned sessions, recent searches, last-open chat).
// It survives logout so the same person signing back in finds everything as
// they left it — but it must never leak into a DIFFERENT account, so on login
// the device is stamped with the owner's user id and the state is wiped when
// the id changes. Device-level keys (theme, preferences, app-mode) are
// untouched either way.
const USER_STATE_OWNER_KEY = "aeva_state_owner";
const USER_STATE_KEYS = ["aeva_pinned_sessions", "aeva_recent_searches"];
const USER_SESSION_KEYS = ["aeva_last_session"];

function reconcileUserState(userId: string): void {
  try {
    if (localStorage.getItem(USER_STATE_OWNER_KEY) === userId) return;
    USER_STATE_KEYS.forEach((k) => localStorage.removeItem(k));
    USER_SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
    localStorage.setItem(USER_STATE_OWNER_KEY, userId);
  } catch {
    /* storage unavailable — nothing persisted to reconcile */
  }
}

// Phones and tablets have no popup windows: `window.open` there opens a second
// tab that hides the app, so those devices sign in within the same tab.
function prefersSameTabSignIn(): boolean {
  try {
    return window.matchMedia("(hover: none), (pointer: coarse)").matches;
  } catch {
    return false;
  }
}

// Desktop popups are off unless opted in: 10 of 26 desktop starters lost the
// popup within seconds (blocked or killed by the browser after `window.open`
// returned a window, which the null-check fallback never catches). The
// same-tab redirect is the flow every phone already uses. Set
// `VITE_POPUP_SIGN_IN=true` to bring the popup back on mouse devices.
const POPUP_SIGN_IN =
  String(import.meta.env.VITE_POPUP_SIGN_IN ?? "").toLowerCase() === "true";

function usesPopupSignIn(): boolean {
  return POPUP_SIGN_IN && !prefersSameTabSignIn();
}

// The first `/auth/me` after a sign-in verifies a token minted seconds ago.
// A transient refusal there (clock skew, a cold backend instance still
// fetching signing keys) is retried once before the attempt is given up.
const LOGIN_RETRY_DELAY_MS = 1000;

async function fetchMeForLogin(): Promise<User> {
  const extras = { skipUnauthorizedHandler: true };
  try {
    return await getMe(extras);
  } catch {
    await new Promise((r) => window.setTimeout(r, LOGIN_RETRY_DELAY_MS));
    return getMe(extras);
  }
}

// A same-tab sign-in that left for Google and came back without passing
// through /auth/callback (back button, a reload, a bounce): the funnel would
// otherwise only see another landing pageview.
function noteRedirectReturn(): void {
  if (window.location.pathname.startsWith("/auth/callback")) return;
  const startedAt = consumeRedirectStart();
  if (startedAt === null) return;
  noteLandingLogin("abandoned");
  analytics.track(AnalyticsEvent.LOGIN_ABANDONED, {
    elapsed_ms: Math.max(0, Date.now() - startedAt),
    via: "returned",
  });
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // Only block on "loading" when a stored session might actually resolve —
  // brand-new visitors (and the build-time prerenderer) get the landing page
  // on the very first render instead of a loader frame.
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return Boolean(
        localStorage.getItem(STORAGE.access) ||
          localStorage.getItem(STORAGE.refresh),
      );
    } catch {
      return false;
    }
  });
  const [signingIn, setSigningIn] = useState(false);
  // True from the moment a same-tab redirect starts until the page is gone
  // (or restored from the back-forward cache, see `pageshow` below).
  const [redirecting, setRedirecting] = useState(false);
  const [signInIssue, setSignInIssue] = useState<SignInIssue | null>(null);
  const tokenRef = useRef<string | null>(null);
  const refreshTimer = useRef<number>();
  // How the in-flight login was started; null after a full-page redirect
  // (the callback page is a fresh load), which is itself the answer.
  const loginMethodRef = useRef<LoginMethod | null>(null);
  const loginStartedAtRef = useRef(0);
  // Ends the in-flight popup attempt; set while a popup is open.
  const cancelSignInRef = useRef<(() => void) | null>(null);

  // True once the initial token restore has settled. Session teardowns that
  // happen *during* boot (dead token found at startup) must clear quietly —
  // a page refresh there would loop forever (boot → 401 → reload → boot).
  const bootDoneRef = useRef(false);

  const clearSession = useCallback(() => {
    try {
      Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage unavailable: nothing persisted to clear */
    }
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
  }, []);

  // Full teardown + hard refresh: drop the session and every in-memory trace
  // of the user (keep-alive tabs, query cache, streams), then leave via a
  // hard replace so the page fully reloads onto the landing/welcome screen
  // and the back button can never reach a signed-in view.
  const hardLogout = useCallback(() => {
    // Forget the analytics identity first (new anonymous id + session) so
    // nothing after this point is attributed to the signed-out user, and
    // push any queued events out before the page goes away.
    analytics.reset();
    setSentryUser(null);
    analytics.flush();
    clearSession();
    queryClient.clear();
    // Always a full page reload onto the landing screen: nothing from the
    // signed-in session (React state, query cache, streams, the old
    // analytics identity) survives it.
    try {
      window.location.replace("/");
    } catch {
      window.location.reload();
    }
  }, [clearSession]);

  // The session became invalid behind the user's back (401 from the API or a
  // failed pre-emptive refresh). After boot, refresh the page like an
  // explicit logout — never leave a signed-out user on a stale page. During
  // boot, just clear state and let the normal render take over.
  const onSessionInvalid = useCallback(() => {
    if (bootDoneRef.current) {
      analytics.track(AnalyticsEvent.SESSION_INVALIDATED);
      hardLogout();
    } else {
      clearSession();
    }
  }, [hardLogout, clearSession]);

  const doRefresh = useCallback(async (): Promise<boolean> => {
    let rt: string | null = null;
    try {
      rt = localStorage.getItem(STORAGE.refresh);
    } catch {
      /* storage unavailable (WebKit, closing page): no refresh token */
    }
    if (!rt) return false;
    try {
      const data = await refreshSession(rt);
      persist(data.access_token, data.refresh_token, data.expires_in);
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleRefresh = useCallback(
    (expiresAt: number) => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      const ms = Math.max(expiresAt - Date.now() - 60_000, 5_000);
      // If the pre-emptive refresh fails, the token is (or is about to be)
      // expired with no way back — log the user out rather than leave them
      // holding a dead token.
      refreshTimer.current = window.setTimeout(() => {
        void doRefresh().then((ok) => {
          if (!ok) onSessionInvalid();
        });
      }, ms);
    },
    [doRefresh, onSessionInvalid],
  );

  const persist = useCallback(
    (accessToken: string, refreshToken: string, expiresIn: number) => {
      const expiresAt = Date.now() + expiresIn * 1000;
      // Storage can be unavailable (WebKit on a closing popup, private
      // mode); the session then lives in memory for this page only.
      try {
        localStorage.setItem(STORAGE.access, accessToken);
        localStorage.setItem(STORAGE.refresh, refreshToken);
        localStorage.setItem(STORAGE.expires, String(expiresAt));
      } catch {
        /* keep the in-memory session */
      }
      tokenRef.current = accessToken;
      setToken(accessToken);
      scheduleRefresh(expiresAt);
    },
    [scheduleRefresh],
  );

  const loadUser = useCallback(async (reason: LoadReason = "boot") => {
    const me = reason === "login" ? await fetchMeForLogin() : await getMe();
    reconcileUserState(me.id);
    setUser(me);
    // Single place identity reaches analytics: covers popup login, redirect
    // login and boot restore. The anonymous trail merges into this person.
    analytics.identify(me);
    setSentryUser(me.id);
    if (reason === "login") {
      noteLandingLogin("succeeded");
      analytics.track(AnalyticsEvent.LOGIN_SUCCEEDED, {
        method: loginMethodRef.current ?? "redirect",
        is_new_user: (me.personalization_status ?? "pending") === "pending",
      });
      loginMethodRef.current = null;
    }
    // Warm the learning profile once at app init so the first chat (and any
    // personalization-aware UI) reads it from cache instead of re-fetching.
    // Fire-and-forget: it must never block or fail user load.
    queryClient
      .prefetchQuery({
        queryKey: qk.learningProfile,
        queryFn: getLearningProfile,
        staleTime: Infinity,
      })
      .catch(() => {
        /* non-critical */
      });
  }, []);

  // Re-fetch the current user (e.g. after onboarding changes the profile),
  // ignoring transient failures so a stale-but-usable session is kept.
  const refreshUser = useCallback(async () => {
    try {
      await loadUser("refresh");
    } catch {
      /* keep existing user */
    }
  }, [loadUser]);

  // Wired while rendering, not in the effect below: React runs a child's
  // effects before its parent's, so the sign-in callback page would otherwise
  // call the API before the client knows the token (and get a 401).
  if (typeof window !== "undefined") {
    setTokenGetter(() => tokenRef.current);
    // Any 401 from the API means the token expired/was revoked — log out
    // (with a page refresh once the app is past boot).
    setUnauthorizedHandler(onSessionInvalid);
  }

  useEffect(() => {
    (async () => {
      // Storage can be gone by now (Safari, on a sign-in popup that has
      // already closed itself): treat that as "no stored session".
      const stored = (key: string): string | null => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      };
      const at = stored(STORAGE.access);
      const expiresAt = Number(stored(STORAGE.expires) || 0);
      if (at && expiresAt > Date.now()) {
        tokenRef.current = at;
        setToken(at);
        scheduleRefresh(expiresAt);
        try {
          await loadUser();
        } catch {
          clearSession();
        }
      } else if (stored(STORAGE.refresh)) {
        if (await doRefresh()) {
          try {
            await loadUser();
          } catch {
            clearSession();
          }
        } else {
          clearSession();
        }
      }
      setLoading(false);
      bootDoneRef.current = true;
      noteRedirectReturn();
    })();

    // Back from Google without finishing (back button): the page may come
    // out of the back-forward cache with the "leaving" state still set.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setSigningIn(false);
      setRedirecting(false);
      noteRedirectReturn();
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSession = useCallback(
    async (accessToken: string, refreshToken: string, expiresIn: number) => {
      setLoading(true);
      persist(accessToken, refreshToken, expiresIn);
      try {
        await loadUser("login");
      } catch (err) {
        // The token was refused (or the profile never loaded): forget it
        // quietly. No hard logout here: the caller reports the failure and
        // keeps its explanation on screen.
        clearSession();
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [persist, loadUser, clearSession],
  );

  const reportSignInIssue = useCallback(
    (issue: SignInIssue) => setSignInIssue(issue),
    [],
  );
  const dismissSignInIssue = useCallback(() => setSignInIssue(null), []);

  const signInWithRedirect = useCallback(() => {
    setSignInIssue(null);
    // Disable the buttons before leaving: a slow phone otherwise takes
    // several taps and starts several OAuth flows.
    setSigningIn(true);
    setRedirecting(true);
    noteLandingLogin("started");
    analytics.track(AnalyticsEvent.LOGIN_STARTED, { method: "redirect" });
    markRedirectStarted();
    analytics.flush();
    window.location.href = `${API_BASE_URL}${ENDPOINTS.AUTH_LOGIN_GOOGLE}`;
  }, []);

  const cancelSignIn = useCallback(() => cancelSignInRef.current?.(), []);

  const signInWithGoogle = useCallback(() => {
    setSignInIssue(null);
    if (!usesPopupSignIn()) {
      signInWithRedirect();
      return;
    }
    const url = `${API_BASE_URL}${ENDPOINTS.AUTH_LOGIN_GOOGLE}`;
    const w = 480;
    const h = 660;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      url,
      "studyassistant-auth",
      `width=${w},height=${h},left=${left},top=${top}`,
    );

    // Popup blocked (or mobile) — fall back to a full-page redirect.
    if (!popup) {
      signInWithRedirect();
      return;
    }

    loginMethodRef.current = "popup";
    loginStartedAtRef.current = performance.now();
    noteLandingLogin("started");
    analytics.track(AnalyticsEvent.LOGIN_STARTED, { method: "popup" });
    setSigningIn(true);

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== AUTH_MESSAGE) return;
      cleanup();
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      // The callback page reported a failure instead of tokens.
      if (typeof d.error === "string") {
        failLogin(d.error);
        return;
      }
      setSession(d.access_token, d.refresh_token, d.expires_in)
        .catch((err: unknown) => failLogin("session", err))
        .finally(() => setSigningIn(false));
    };

    function failLogin(reason: string, err?: unknown) {
      setSigningIn(false);
      noteLandingLogin("failed");
      analytics.track(AnalyticsEvent.LOGIN_FAILED, {
        reason,
        method: "popup",
        status: apiErrorStatus(err),
        error_kind: err === undefined ? undefined : errorKind(err),
      });
      loginMethodRef.current = null;
      setSignInIssue({ kind: "failed", reason });
    }

    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        setSigningIn(false);
        // Closed without posting tokens back: the user gave up (or the
        // callback failed inside the popup, which tracks its own failure).
        noteLandingLogin("abandoned");
        analytics.track(AnalyticsEvent.LOGIN_ABANDONED, {
          elapsed_ms: Math.round(performance.now() - loginStartedAtRef.current),
        });
        loginMethodRef.current = null;
        // Say so: a silently vanishing dialog reads as "nothing happened".
        setSignInIssue({ kind: "abandoned" });
      }
    }, 600);

    function cleanup() {
      window.clearInterval(poll);
      window.removeEventListener("message", onMessage);
      cancelSignInRef.current = null;
    }

    // The user gave up from the dialog while the popup was still open (it may
    // be hidden behind another window): close it and stop waiting, quietly.
    cancelSignInRef.current = () => {
      cleanup();
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      setSigningIn(false);
      noteLandingLogin("abandoned");
      analytics.track(AnalyticsEvent.LOGIN_ABANDONED, {
        elapsed_ms: Math.round(performance.now() - loginStartedAtRef.current),
        via: "cancel",
      });
      loginMethodRef.current = null;
    };

    window.addEventListener("message", onMessage);
  }, [setSession, signInWithRedirect]);

  // Explicit sign-out: the same full teardown + page refresh as any other
  // session end. Persisted per-user niceties (pins, recents) deliberately
  // stay: `reconcileUserState` wipes them at next login if the account
  // differs.
  const logout = hardLogout;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isDebugUser: !!user?.is_debug_user,
        loading,
        signingIn,
        signingInMethod: redirecting ? "redirect" : signingIn ? "popup" : null,
        popupSignIn: usesPopupSignIn(),
        signInIssue,
        signInWithGoogle,
        signInWithRedirect,
        cancelSignIn,
        reportSignInIssue,
        dismissSignInIssue,
        setSession,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
