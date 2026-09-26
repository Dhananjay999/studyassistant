// Anonymous → authenticated identity. The anonymous id is ours (persisted in
// localStorage) and is handed to PostHog as its bootstrap distinct id, so a
// later `identify(user_id)` merges the pre-login trail into the person.

import type { AnalyticsUser, UserTraits } from "./types";
import { STORAGE_KEYS, randomId, read, write } from "./storage";

export class IdentityManager {
  private anonymousId: string | null = null;
  private userId: string | null = null;
  private lastTraitsKey = "";

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

  /** Forget the user and mint a fresh anonymous id (logout). */
  reset(): string {
    this.userId = null;
    this.lastTraitsKey = "";
    this.anonymousId = `anon_${randomId()}`;
    write(STORAGE_KEYS.anonymousId, this.anonymousId);
    return this.anonymousId;
  }
}
