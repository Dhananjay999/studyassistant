// Identity: three ids with different lifetimes.
//
//   device_id     `dev_…`   Created once per browser profile and NEVER rotated
//                          (kept in localStorage and mirrored in a 1-year
//                          first-party cookie so either store surviving is
//                          enough). Answers "is this the same device?" across
//                          logins, logouts and browser restarts.
//   anonymous_id  `anon_…`  Persisted in localStorage; handed to PostHog as
//                          its bootstrap distinct id so `identify(user_id)`
//                          merges the pre-login trail into the person. Rotated
//                          on logout on purpose: a shared device must not glue
//                          the next visitor's events to the previous account.
//   user_id                 The app account, set by identify().

import type { AnalyticsUser, UserTraits } from "./types";
import {
  DEVICE_COOKIE,
  STORAGE_KEYS,
  randomId,
  read,
  readCookie,
  write,
  writeCookie,
} from "./storage";

const DEVICE_COOKIE_DAYS = 365;

export class IdentityManager {
  private anonymousId: string | null = null;
  private deviceId: string | null = null;
  private userId: string | null = null;
  private lastTraitsKey = "";

  /** Stable per-browser id; never changes once created (see header). */
  getDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    const fromStorage = read(STORAGE_KEYS.deviceId);
    const fromCookie = readCookie(DEVICE_COOKIE);
    const existing =
      (fromStorage?.startsWith("dev_") && fromStorage) ||
      (fromCookie?.startsWith("dev_") && fromCookie) ||
      null;
    this.deviceId = existing ?? `dev_${randomId()}`;
    // Keep both stores in sync (and refresh the cookie's expiry).
    if (fromStorage !== this.deviceId) write(STORAGE_KEYS.deviceId, this.deviceId);
    writeCookie(DEVICE_COOKIE, this.deviceId, DEVICE_COOKIE_DAYS);
    return this.deviceId;
  }

  getAnonymousId(): string {
    if (this.anonymousId) return this.anonymousId;
    const stored = read(STORAGE_KEYS.anonymousId);
    if (stored && stored.startsWith("anon_")) {
      this.anonymousId = stored;
    } else {
      this.anonymousId = `anon_${randomId()}`;
      write(STORAGE_KEYS.anonymousId, this.anonymousId);
    }
    return this.anonymousId;
  }

  getUserId(): string | null {
    return this.userId;
  }

  /** True when this call changes the identified user (first identify or a
   *  different id); false when only traits may have changed. */
  identify(
    user: AnalyticsUser,
    extra: Partial<UserTraits>,
  ): { userChanged: boolean; traitsChanged: boolean; traits: UserTraits } {
    const traits: UserTraits = {
      email: user.email,
      name: user.full_name ?? undefined,
      personalization_status: user.personalization_status,
      is_debug_user: !!user.is_debug_user,
      ...extra,
    };
    const key = JSON.stringify([user.id, traits]);
    const userChanged = this.userId !== user.id;
    const traitsChanged = this.lastTraitsKey !== key;
    this.userId = user.id;
    this.lastTraitsKey = key;
    return { userChanged, traitsChanged, traits };
  }

  /** Forget the user and mint a fresh anonymous id (logout). The device id
   *  is deliberately untouched. */
  reset(): string {
    this.userId = null;
    this.lastTraitsKey = "";
    this.anonymousId = `anon_${randomId()}`;
    write(STORAGE_KEYS.anonymousId, this.anonymousId);
    return this.anonymousId;
  }
}
