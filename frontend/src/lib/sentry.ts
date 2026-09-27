// Sentry error + performance monitoring. App code only ever calls the helpers
// exported here — never `@sentry/react` directly — so the SDK stays in its
// own async chunk, off the landing page's critical path (like analytics).
//
// Off unless `VITE_SENTRY_DSN` is set. Until the SDK chunk arrives, uncaught
// errors and rejections are buffered by lightweight listeners and replayed,
// so a crash during boot is still reported.

import { API_BASE_URL } from "./api";

type SentryModule = typeof import("@sentry/react");

interface ErrorContext {
  /** React component stack, from an error boundary. */
  componentStack?: string;
}

const MAX_BUFFERED = 10;
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

let sdk: SentryModule | null = null;
let started = false;
let pendingUserId: string | null = null;
const buffered: { error: unknown; context?: ErrorContext }[] = [];

function dsn(): string | null {
  const value = (import.meta.env as Record<string, unknown>).VITE_SENTRY_DSN;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tracesSampleRate(): number {
  const raw = (import.meta.env as Record<string, unknown>)
    .VITE_SENTRY_TRACES_SAMPLE_RATE;
  const rate = typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return rate >= 0 && rate <= 1 ? rate : DEFAULT_TRACES_SAMPLE_RATE;
}

function stripFragment(url: string): string {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
}

function send(error: unknown, context?: ErrorContext) {
  if (!sdk) return;
  sdk.captureException(
    error,
    context?.componentStack
      ? { contexts: { react: { componentStack: context.componentStack } } }
      : undefined,
  );
}

function onEarlyError(event: ErrorEvent) {
  captureException(event.error ?? event.message);
}

function onEarlyRejection(event: PromiseRejectionEvent) {
  captureException(event.reason);
}

/** Start Sentry. Safe to call once at boot; a no-op without a DSN. */
export function initSentry(): void {
  const key = dsn();
  if (started || !key || typeof window === "undefined") return;
  started = true;

  window.addEventListener("error", onEarlyError);
  window.addEventListener("unhandledrejection", onEarlyRejection);

  void import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn: key,
        environment: __BUILD_ENV__,
        release: `aeva-frontend@${__APP_VERSION__}+${__BUILD_ID__}`,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: tracesSampleRate(),
        tracePropagationTargets: [API_BASE_URL],
        // Prompts, answers and uploads are user content: never attach
        // request data. The user is identified by id only.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          genAI: { inputs: false, outputs: false },
        },
        // The OAuth callback carries tokens in the URL fragment.
        beforeSend(event) {
          if (event.request?.url) {
            event.request.url = stripFragment(event.request.url);
          }
          return event;
        },
        beforeBreadcrumb(crumb) {
          if (crumb.category === "navigation" && crumb.data) {
            for (const key of ["from", "to"]) {
              const value = crumb.data[key];
              if (typeof value === "string") {
                crumb.data[key] = stripFragment(value);
              }
            }
          }
          return crumb;
        },
      });
      // The SDK's own global handlers take over from here.
      window.removeEventListener("error", onEarlyError);
      window.removeEventListener("unhandledrejection", onEarlyRejection);
      sdk = Sentry;
      if (pendingUserId) Sentry.setUser({ id: pendingUserId });
      buffered.splice(0).forEach((item) => send(item.error, item.context));
    })
    .catch(() => {
      // Blocked or offline — error reporting is best-effort only.
    });
}

/** Report a handled error (or one caught by an error boundary). */
export function captureException(error: unknown, context?: ErrorContext): void {
  if (!started) return;
  if (sdk) {
    send(error, context);
  } else if (buffered.length < MAX_BUFFERED) {
    buffered.push({ error, context });
  }
}

/** Attribute events to the signed-in user (id only); `null` on logout. */
export function setSentryUser(userId: string | null): void {
  pendingUserId = userId;
  sdk?.setUser(userId ? { id: userId } : null);
}
