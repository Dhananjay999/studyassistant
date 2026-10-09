// Entry point for the secret admin route. Owns its own auth gate (independent
// of the user app) and a lightweight view router. Rendered by a single
// <Route> in App.tsx, outside ProtectedRoute.
//
// The current view lives in the URL's search params (`?v=users`,
// `?v=user&id=…`, `?v=resource&r=files`) so the browser/phone Back button
// walks user detail → users instead of leaving the panel, and a refresh
// keeps the admin where they were. Only known keys are read; anything else
// falls back to the overview.

import { useCallback, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import {
  BookMarked,
  Bug,
  FileText,
  Flag,
  Layers,
  LayoutDashboard,
  ListChecks,
  Loader2,
  MessageSquare,
  ScrollText,
  Search,
  ShieldAlert,
  Smartphone,
  Users as UsersIcon,
} from "lucide-react";
import { AdminShell, type AdminNavItem } from "@/components/admin/AdminShell";
import { TRACE_NAV } from "@/components/admin/trace/traceRoutes";
import {
  AdminAuthProvider,
  useAdminAuth,
} from "@/pages/admin/AdminAuthContext";
import { AdminLogin } from "@/pages/admin/AdminLogin";
import { AdminOverview } from "@/pages/admin/AdminOverview";
import { AdminUsers } from "@/pages/admin/AdminUsers";
import { AdminUserDetail } from "@/pages/admin/AdminUserDetail";
import { AdminResources } from "@/pages/admin/AdminResources";
import { AdminSearch } from "@/pages/admin/AdminSearch";
import { AdminAuditLog } from "@/pages/admin/AdminAuditLog";
import { AdminDangerZone } from "@/pages/admin/AdminDangerZone";
import { AdminDebugUsers } from "@/pages/admin/AdminDebugUsers";
import { AdminDevTools } from "@/pages/admin/AdminDevTools";
import { AdminFeatureFlags } from "@/pages/admin/AdminFeatureFlags";
import { AdminTraceViews } from "@/pages/admin/AdminTraceViews";
import type { ResourceKey } from "@/types/admin";

const SIMPLE_VIEWS = [
  "overview",
  "users",
  "search",
  "debug",
  "flags",
  "audit",
  "devtools",
  "danger",
  "traces",
  "prompts",
] as const;
type SimpleView = (typeof SIMPLE_VIEWS)[number];

type View =
  | { name: SimpleView }
  | { name: "user"; id: string }
  | { name: "resource"; resource: ResourceKey };

const RESOURCE_KEYS: ResourceKey[] = [
  "sessions",
  "quizzes",
  "flashcards",
  "bookmarks",
  "files",
];

/** Nav key → the view it opens (typed lookup; unknown keys do nothing). */
const NAV_TO_VIEW: Record<string, View> = {
  ...Object.fromEntries(
    SIMPLE_VIEWS.map((name): [string, View] => [name, { name }]),
  ),
  ...Object.fromEntries(
    RESOURCE_KEYS.map((resource): [string, View] => [
      resource,
      { name: "resource", resource },
    ]),
  ),
};

function parseView(params: URLSearchParams): View {
  const v = params.get("v") ?? "";
  if (v === "user") {
    const id = params.get("id");
    return id ? { name: "user", id } : { name: "users" };
  }
  if (v === "resource") {
    const resource = RESOURCE_KEYS.find((key) => key === params.get("r"));
    return resource ? { name: "resource", resource } : { name: "overview" };
  }
  const simple = SIMPLE_VIEWS.find((name) => name === v);
  return { name: simple ?? "overview" };
}

function viewToParams(view: View): Record<string, string> {
  if (view.name === "user") return { v: "user", id: view.id };
  if (view.name === "resource") return { v: "resource", r: view.resource };
  return view.name === "overview" ? {} : { v: view.name };
}

const NAV: AdminNavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "sessions", label: "Sessions", icon: MessageSquare },
  { key: "quizzes", label: "Quizzes", icon: ListChecks },
  { key: "flashcards", label: "Flashcards", icon: Layers },
  { key: "bookmarks", label: "Bookmarks", icon: BookMarked },
  { key: "files", label: "Files", icon: FileText },
  { key: "search", label: "Search", icon: Search },
  ...TRACE_NAV,
  { key: "debug", label: "Debug Users", icon: Bug },
  { key: "flags", label: "Feature Flags", icon: Flag },
  { key: "audit", label: "Audit Log", icon: ScrollText },
  { key: "devtools", label: "Dev Tools", icon: Smartphone },
  { key: "danger", label: "Danger Zone", icon: ShieldAlert },
];

function CenterLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function AdminInner() {
  const { status, username, logout } = useAdminAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = useMemo(() => parseView(searchParams), [searchParams]);
  const setView = useCallback(
    (next: View, options?: { replace?: boolean }) =>
      setSearchParams(viewToParams(next), { replace: options?.replace }),
    [setSearchParams],
  );

  if (status === "checking") return <CenterLoader />;
  if (status === "anon") return <AdminLogin />;

  const navigate = (key: string) => {
    const target = NAV_TO_VIEW[key];
    if (target) setView(target);
  };

  const active =
    view.name === "user"
      ? "users"
      : view.name === "resource"
        ? view.resource
        : view.name;
  const activeLabel = NAV.find((item) => item.key === active)?.label;

  return (
    <>
      <Helmet>
        <title>{activeLabel ? `${activeLabel} · Admin` : "Admin"}</title>
      </Helmet>
      <AdminShell
      nav={NAV}
      active={active}
      onNavigate={navigate}
      username={username}
      onLogout={logout}
    >
      {view.name === "overview" && (
        <AdminOverview onSelectUser={(id) => setView({ name: "user", id })} />
      )}
      {view.name === "debug" && <AdminDebugUsers />}
      {view.name === "audit" && <AdminAuditLog />}
      {view.name === "users" && (
        <AdminUsers onSelectUser={(id) => setView({ name: "user", id })} />
      )}
      {view.name === "user" && (
        <AdminUserDetail
          userId={view.id}
          onBack={() => setView({ name: "users" })}
          // Replace: Back must never return to a user that no longer exists.
          onDeleted={() => setView({ name: "users" }, { replace: true })}
        />
      )}
      {view.name === "resource" && (
        <AdminResources key={view.resource} resource={view.resource} />
      )}
      {view.name === "search" && (
        <AdminSearch onOpenUser={(id) => setView({ name: "user", id })} />
      )}
      <AdminTraceViews />
      {view.name === "flags" && <AdminFeatureFlags />}
      {view.name === "devtools" && <AdminDevTools />}
      {view.name === "danger" && <AdminDangerZone />}
      </AdminShell>
    </>
  );
}

export default function AdminApp() {
  return (
    <>
      <Helmet>
        <title>Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <AdminAuthProvider>
        <AdminInner />
      </AdminAuthProvider>
    </>
  );
}
