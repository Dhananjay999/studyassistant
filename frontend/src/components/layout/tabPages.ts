import { lazy } from "react";

// The heavy app pages that back the four persistent mobile tabs. Declared ONCE
// here and imported by both the router (desktop Outlet, in App.tsx) and the
// mobile keep-alive host (MobileTabsHost) so each tab has a single lazy
// identity / single chunk — importing the same page via two separate `lazy()`
// calls would create distinct component identities and risk a double mount.
export const ChatPage = lazy(() => import("@/pages/ChatPage"));
export const QuizzesPage = lazy(() => import("@/pages/QuizzesPage"));
export const FlashcardsPage = lazy(() => import("@/pages/FlashcardsPage"));
export const BookmarksPage = lazy(() => import("@/pages/BookmarksPage"));

/** Tab path → its lazy page component, in bottom-nav order. */
export const TAB_PAGES = {
  "/chat": ChatPage,
  "/quizzes": QuizzesPage,
  "/flashcards": FlashcardsPage,
  "/bookmarks": BookmarksPage,
} as const;

export type TabPath = keyof typeof TAB_PAGES;

/** The four tab paths, in order. */
export const TAB_PATHS = Object.keys(TAB_PAGES) as TabPath[];

/** Whether a pathname is one of the keep-alive tab roots. */
export function isTabPath(pathname: string): pathname is TabPath {
  return (TAB_PATHS as string[]).includes(pathname);
}
