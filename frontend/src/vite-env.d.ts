/// <reference types="vite/client" />

// Build-time constants injected by vite.config.ts `define` (About screen
// version info). See APP_META in src/components/settings/constants.ts.
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
declare const __BUILD_ENV__: string;

// Runtime debug handle installed by the analytics SDK (src/lib/analytics).
interface Window {
  __aeva_analytics?: {
    debug: boolean;
    readonly session: unknown;
    readonly anonymousId: string | null;
    readonly deviceId: string | null;
    readonly ready: boolean;
    /** Events waiting in the outbox for the next idle drain. */
    readonly pending: number;
    /** Send everything pending now (sendBeacon). */
    flush: () => void;
  };
}
