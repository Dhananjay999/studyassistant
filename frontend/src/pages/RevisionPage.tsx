// AI Revision dashboard: what to revise today, driven by the backend's
// topic-level spaced-repetition schedule. Three buckets (urgent / due today /
// recently mastered), the study streak, and a continue-learning shortcut.

import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  Flame,
  MessageSquare,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/common/GlassCard";
import { Seo } from "@/components/common/Seo";
import { Skeleton } from "@/components/ui/skeleton";
import { StreakCard } from "@/components/common/StreakCard";
import { Button } from "@/components/ui/button";
import { RevisionTopicRow } from "@/components/revision/RevisionTopicRow";
import { useRevisionDashboard } from "@/hooks/api";
import { lastStudied } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import type { RevisionDashboard, RevisionTopicItem } from "@/types";

export default function RevisionPage() {
  const { data, isLoading, isError, refetch } = useRevisionDashboard();

  return (
    <PageContainer title="Revision">
      <Seo title="Revision — Aeva" noindex path="/revision" />
      <div className="mx-auto max-w-4xl space-y-6 p-4">
        {isLoading ? (
          <DashboardSkeleton />
        ) : isError || !data ? (
          <GlassCard className="grid place-items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load your revision plan.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </GlassCard>
        ) : (
          <Dashboard data={data} />
        )}
      </div>
    </PageContainer>
  );
}

function Dashboard({ data }: { data: RevisionDashboard }) {
  const navigate = useNavigate();
  const needs = data.needs_revision ?? [];
  const dueToday = data.due_today ?? [];
  const mastered = data.recently_mastered ?? [];
  const empty =
    needs.length === 0 && dueToday.length === 0 && mastered.length === 0;

  return (
    <>
      <StreakCard
        streak={data.streak_days}
        subtitle={
          data.counts.due > 0
            ? `${data.counts.due} topic${data.counts.due === 1 ? "" : "s"} due for revision today.`
            : undefined
        }
      />

      {data.continue_learning && (
        <GlassCard className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Continue learning
            </p>
            <p className="mt-1 truncate font-display font-bold">
              {data.continue_learning.title}
            </p>
            <p className="text-xs text-muted-foreground">
              Last studied {lastStudied(data.continue_learning.updated_at)}
            </p>
          </div>
          <Button
            variant="brand"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() =>
              navigate(`/chat?sessionId=${data.continue_learning!.id}`)
            }
          >
            <MessageSquare className="h-3.5 w-3.5" /> Continue
          </Button>
        </GlassCard>
      )}

      {empty ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
          <Sparkles className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Nothing to revise yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Study a topic in chat, take a quiz, or review flashcards and
            your revision schedule will build itself.
          </p>
          <Button
            variant="brand"
            className="mt-4"
            onClick={() => navigate("/chat")}
          >
            Start learning
          </Button>
        </div>
      ) : (
        <>
          <Bucket
            title="Needs immediate revision"
            icon={Flame}
            iconCls="text-red-500"
            items={needs}
          />
          <Bucket
            title="Due today"
            icon={BookOpen}
            iconCls="text-brand-1"
            items={dueToday}
          />
          <Bucket
            title="Recently mastered"
            icon={CheckCircle2}
            iconCls="text-emerald-500"
            items={mastered}
          />
        </>
      )}
    </>
  );
}

function Bucket({
  title,
  icon: Icon,
  iconCls,
  items,
}: {
  title: string;
  icon: LucideIcon;
  iconCls: string;
  items: RevisionTopicItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className={cn("h-4 w-4", iconCls)} />
        {title}
        <span className="tabular-nums">({items.length})</span>
      </h2>
      <div className="space-y-3">
        {items.map((item, i) => (
          <RevisionTopicRow key={item.id} item={item} index={i} />
        ))}
      </div>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-20 rounded-2xl" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
