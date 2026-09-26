// Environment-aware analytics configuration. Everything comes from Vite env
// vars plus the build-time globals defined in vite.config.ts (`__BUILD_ENV__`,
// `__APP_VERSION__`, `__BUILD_ID__`). Resolved lazily so importing the SDK
// never evaluates browser APIs at module scope (prerender safety).

import type { AnalyticsConfig } from "./types";
import { STORAGE_KEYS, read } from "./storage";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // hard cap

function envString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildGlobal(name: "__BUILD_ENV__" | "__APP_VERSION__" | "__BUILD_ID__"): string {
  try {
    // Replaced at build time by Vite `define`; guarded for any tooling that
    // evaluates the module without those globals.
    if (name === "__BUILD_ENV__") return __BUILD_ENV__;
    if (name === "__APP_VERSION__") return __APP_VERSION__;
    return __BUILD_ID__;
  } catch {
    return "unknown";
  }
}

/** True when debug logging should be on: explicit flag, non-production build,
 *  or a per-browser override (`localStorage.aeva_analytics_debug = "1"`). */
export function resolveDebug(appEnv: string): boolean {
  const env = import.meta.env as Record<string, unknown>;
  const flag = envString(env.VITE_ANALYTICS_DEBUG);
  if (flag === "true") return true;
  if (flag === "false") return false;
  if (read(STORAGE_KEYS.debug) === "1") return true;
  return appEnv !== "production";
}

export function resolveConfig(): AnalyticsConfig {
  const env = import.meta.env as Record<string, unknown>;
  const posthogKey = envString(env.VITE_POSTHOG_KEY);
  const enabledFlag = envString(env.VITE_ANALYTICS_ENABLED);
  const appEnv = buildGlobal("__BUILD_ENV__");

  return {
    enabled: enabledFlag !== "false" && !!posthogKey,
    debug: resolveDebug(appEnv),
    posthogKey,
    posthogHost: envString(env.VITE_POSTHOG_HOST) ?? "https://us.i.posthog.com",
    appEnv,
    appVersion: buildGlobal("__APP_VERSION__"),
    buildId: buildGlobal("__BUILD_ID__"),
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    sessionMaxAgeMs: SESSION_MAX_AGE_MS,
  };
}
