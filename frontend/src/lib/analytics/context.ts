// Page / device / app context. Static parts are computed once per page load;
// dynamic parts (page, viewport, connectivity) are read per event. No UA
// parsing library: a small heuristic over `navigator.userAgentData` with a
// user-agent string fallback is enough for analytics buckets.

import type { AppContext, DeviceContext, PageContext } from "./types";
import { isBrowser } from "./storage";
import { routeName } from "./routeName";

interface UAData {
  brands?: { brand: string; version: string }[];
  mobile?: boolean;
  platform?: string;
}

function parseBrowser(ua: string): { browser: string; version: string } {
  const rules: [string, RegExp][] = [
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, re] of rules) {
    const m = ua.match(re);
    if (m) return { browser: name, version: m[1].split(".").slice(0, 2).join(".") };
  }
  return { browser: "unknown", version: "" };
}

function parseOS(ua: string, platformHint?: string): string {
  if (platformHint) return platformHint;
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "unknown";
}

function deviceType(ua: string, uaMobile?: boolean): DeviceContext["device_type"] {
  if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) {
    return "tablet";
  }
  if (uaMobile || /Mobi|iPhone|iPod|Android.*Mobile/.test(ua)) return "mobile";
  // Coarse-pointer + narrow viewport catches mobile WebViews with odd UAs.
  try {
    if (
      window.matchMedia?.("(pointer: coarse)").matches &&
      window.innerWidth < 768
    ) {
      return "mobile";
    }
  } catch {
    /* ignore */
  }
  return "desktop";
}

let staticDevice: Omit<DeviceContext, "viewport_width" | "viewport_height" | "connection_type" | "online"> | null = null;

function staticDeviceContext() {
  if (staticDevice) return staticDevice;
  const nav = navigator as Navigator & { userAgentData?: UAData };
  const ua = nav.userAgent || "";
  const uad = nav.userAgentData;
  const { browser, version } = parseBrowser(ua);
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* ignore */
  }
  staticDevice = {
    device_type: deviceType(ua, uad?.mobile),
    os: parseOS(ua, uad?.platform),
    browser,
    browser_version: version,
    screen_width: window.screen?.width ?? 0,
    screen_height: window.screen?.height ?? 0,
    language: nav.language || "",
    timezone: tz,
  };
  return staticDevice;
}

export function getDeviceContext(): DeviceContext {
  const base = staticDeviceContext();
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string };
  };
  return {
    ...base,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    connection_type: nav.connection?.effectiveType,
    online: typeof nav.onLine === "boolean" ? nav.onLine : undefined,
  };
}

export function getPageContext(): PageContext {
  const loc = window.location;
  const path = loc.pathname;
  return {
    path,
    url: loc.origin + path, // no query string: ids/PII stay out of page_url
    title: document.title || "",
    name: routeName(path),
    referrer: safeReferrer(),
  };
}

/** Referrer with query stripped (they can carry tokens or search terms). */
export function safeReferrer(): string {
  try {
    const ref = document.referrer;
    if (!ref) return "";
    const u = new URL(ref);
    return u.origin + u.pathname;
  } catch {
    return "";
  }
}

export function buildAppContext(
  env: string,
  version: string,
  buildId: string,
  isAppMode: boolean,
): AppContext {
  return { env, version, build_id: buildId, platform: "web", is_app_mode: isAppMode };
}

/** Empty context for the (never-used) SSR path so types stay total. */
export function emptyDevice(): DeviceContext {
  return {
    device_type: "desktop",
    os: "",
    browser: "",
    browser_version: "",
    screen_width: 0,
    screen_height: 0,
    viewport_width: 0,
    viewport_height: 0,
    language: "",
    timezone: "",
  };
}

export function contextAvailable(): boolean {
  return isBrowser();
}
