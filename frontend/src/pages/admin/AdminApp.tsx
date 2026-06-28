// Entry point for the secret admin route. Owns its own auth gate (independent
// of the user app) and a lightweight in-memory view router. Rendered by a
// single <Route> in App.tsx, outside ProtectedRoute.

import { useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  BookMarked,
  FileText,
  Layers,
  LayoutDashboard,
  ListChecks,
  Loader2,
  MessageSquare,
  Search,
  ShieldAlert,
  Users as UsersIcon,
} from "lucide-react";
import { AdminShell, type AdminNavItem } from "@/components/admin/AdminShell";
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
import { AdminDangerZone } from "@/pages/admin/AdminDangerZone";
import type { ResourceKey } from "@/types/admin";

type View =
  | { name: "overview" }
  | { name: "users" }
  | { name: "user"; id: string }
  | { name: "resource"; resource: ResourceKey }
  | { name: "search" }
  | { name: "danger" };

const RESOURCE_KEYS: ResourceKey[] = [
  "sessions",
  "quizzes",
  "flashcards",
  "bookmarks",
  "files",
];

const NAV: AdminNavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "sessions", label: "Sessions", icon: MessageSquare },
  { key: "quizzes", label: "Quizzes", icon: ListChecks },
  { key: "flashcards", label: "Flashcards", icon: Layers },
  { key: "bookmarks", label: "Bookmarks", icon: BookMarked },
  { key: "files", label: "Files", icon: FileText },
  { key: "search", label: "Search", icon: Search },
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
  const [view, setView] = useState<View>({ name: "overview" });

  if (status === "checking") return <CenterLoader />;
  if (status === "anon") return <AdminLogin />;

  const navigate = (key: string) => {
    if (
      key === "overview" ||
      key === "users" ||
      key === "search" ||
      key === "danger"
    ) {
      setView({ name: key });
    } else if ((RESOURCE_KEYS as string[]).includes(key)) {
      setView({ name: "resource", resource: key as ResourceKey });
    }
  };

  const active =
    view.name === "user"
      ? "users"
      : view.name === "resource"
        ? view.resource
        : view.name;

  return (
    <AdminShell
      nav={NAV}
      active={active}
      onNavigate={navigate}
      username={username}
      onLogout={logout}
    >
      {view.name === "overview" && <AdminOverview />}
      {view.name === "users" && (
        <AdminUsers onSelectUser={(id) => setView({ name: "user", id })} />
      )}
      {view.name === "user" && (
        <AdminUserDetail
          userId={view.id}
          onBack={() => setView({ name: "users" })}
          onDeleted={() => setView({ name: "users" })}
        />
      )}
      {view.name === "resource" && (
        <AdminResources key={view.resource} resource={view.resource} />
      )}
      {view.name === "search" && (
        <AdminSearch onOpenUser={(id) => setView({ name: "user", id })} />
      )}
      {view.name === "danger" && <AdminDangerZone />}
    </AdminShell>
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
