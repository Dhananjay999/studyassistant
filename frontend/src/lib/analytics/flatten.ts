// Turns the nested TrackPayload into the flat property bag providers send.
// Context keys come first and are reserved (see sanitize.ts RESERVED_KEYS),
// event props are spread last but can never overwrite them.

import type { FlatProps, TrackPayload } from "./types";

export function flatten(payload: TrackPayload): FlatProps {
  const { identity, session, page, device, campaign, app, props } = payload;
  const last = campaign.last_touch;
  const first = campaign.first_touch;

  const flat: FlatProps = {
    anonymous_id: identity.anonymous_id,
    user_id: identity.user_id,
    session_id: session.id,
    session_number: session.number,
    session_started_at: session.started_at,

    page_path: page.path,
    page_url: page.url,
    page_title: page.title,
    page_name: page.name,
    referrer: page.referrer,

    device_type: device.device_type,
    os: device.os,
    browser: device.browser,
    browser_version: device.browser_version,
    screen_width: device.screen_width,
    screen_height: device.screen_height,
    viewport_width: device.viewport_width,
    viewport_height: device.viewport_height,
    language: device.language,
    timezone: device.timezone,
    connection_type: device.connection_type,
    online: device.online,

    utm_source: last?.utm_source,
    utm_medium: last?.utm_medium,
    utm_campaign: last?.utm_campaign,
    utm_term: last?.utm_term,
    utm_content: last?.utm_content,
    first_utm_source: first?.utm_source,
    first_utm_medium: first?.utm_medium,
    first_utm_campaign: first?.utm_campaign,
    referrer_domain: last?.referrer_domain ?? first?.referrer_domain,
    landing_page: first?.landing_page,

    app_env: app.env,
    app_version: app.version,
    build_id: app.build_id,
    platform: app.platform,
    is_app_mode: app.is_app_mode,
  };

  for (const [k, v] of Object.entries(props)) {
    if (k in flat) continue;
    flat[k] = v as FlatProps[string];
  }
  // Drop undefined so providers don't serialise "undefined" keys.
  for (const k of Object.keys(flat)) {
    if (flat[k] === undefined) delete flat[k];
  }
  return flat;
}
