// Experiment flags read through the analytics provider (PostHog). A flag
// that does not exist, has not loaded yet, or is read on the server resolves
// to no variant, and every component treats "no variant" as the control.

/** Landing hero: tappable prompt chips, one-line value prop, exit-intent
 *  sign-in prompt on desktop and a 15 s prompt threshold on phones.
 *  Variants: `control` | `test`. */
export const LANDING_HERO_EXPERIMENT = "landing-hero-v2";
