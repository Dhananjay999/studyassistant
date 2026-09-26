// Maps a pathname to a stable `page_name` so dashboards group by page, not
// by id-bearing URL. Keep in sync with the routes in App.tsx.

const ROUTES: [RegExp, string][] = [
  [/^\/$/, "landing"],
  [/^\/features\/?$/, "features"],
  [/^\/about\/?$/, "about"],
  [/^\/privacy\/?$/, "privacy"],
  [/^\/terms\/?$/, "terms"],
  [/^\/auth\/callback/, "auth_callback"],
  [/^\/share\/[^/]+/, "share"],
  [/^\/quiz\/share\/[^/]+/, "quiz_share"],
  [/^\/quiz\/result\/[^/]+/, "quiz_result_share"],
  [/^\/chat\/?$/, "chat"],
  [/^\/bookmarks\/?$/, "bookmarks"],
  [/^\/bookmarks\/[^/]+/, "bookmark_detail"],
  [/^\/quizzes\/?$/, "quizzes"],
  [/^\/flashcards\/?$/, "flashcards"],
  [/^\/spaces\/?$/, "spaces"],
  [/^\/spaces\/[^/]+/, "space_detail"],
  [/^\/notes\/?$/, "notes"],
  [/^\/notes\/[^/]+/, "note_detail"],
  [/^\/analytics\/?$/, "analytics"],
  [/^\/revision\/?$/, "revision"],
  [/^\/files\/?$/, "files"],
  [/^\/profile\/?$/, "profile"],
  [/^\/profile\/[^/]+/, "profile_section"],
];

export function routeName(pathname: string): string {
  for (const [re, name] of ROUTES) {
    if (re.test(pathname)) return name;
  }
  return "other";
}

// Query params that are safe to attach to page_entry: internal entity ids and
// the auth error code. Everything else (search terms, tokens) is dropped.
const SAFE_QUERY: Record<string, string> = {
  sessionId: "qp_session_id",
  quizId: "qp_quiz_id",
  setId: "qp_set_id",
  fileId: "qp_file_id",
  auth_error: "qp_auth_error",
};

export function pickSafeSearch(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!search) return out;
  try {
    const params = new URLSearchParams(search);
    for (const [from, to] of Object.entries(SAFE_QUERY)) {
      const v = params.get(from);
      if (v) out[to] = v.slice(0, 64);
    }
  } catch {
    /* ignore */
  }
  return out;
}
