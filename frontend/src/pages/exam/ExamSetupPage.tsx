// /exam/setup — the plan setup form. When an active plan already exists the
// student is told that starting over archives it (the backend does that on
// POST /exam-prep/plan).

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Info } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Seo } from "@/components/common/Seo";
import { Button } from "@/components/ui/button";
import { ExamSetupForm } from "@/components/exam/ExamSetupForm";
import { useExamDashboard, useLearningProfile } from "@/hooks/api";
import { useFeature } from "@/hooks/useFeature";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { hasExamPlan } from "@/types";

export default function ExamSetupPage() {
  const navigate = useNavigate();
  const enabled = useFeature("exam_prep", false);
  const dashboard = useExamDashboard(enabled);
  const profile = useLearningProfile();
  const hasPlan = hasExamPlan(dashboard.data);
  const tracked = useRef(false);

  // SETUP_STARTED once the profile has settled, so `prefilled` is accurate.
  useEffect(() => {
    if (tracked.current || profile.isPending) return;
    tracked.current = true;
    const p = profile.data;
    analytics.track(AnalyticsEvent.EXAM_PREP_SETUP_STARTED, {
      prefilled: !!(p?.context?.exam || (p?.focus_areas?.length ?? 0) > 0),
    });
  }, [profile.isPending, profile.data]);

  return (
    <PageContainer title="Exam Prep">
      <Seo title="Set up your exam plan — Aeva" noindex path="/exam/setup" />
      <div className="mx-auto max-w-2xl lg:p-4">
        <div className="mb-4 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to Exam Prep"
            onClick={() => navigate("/exam")}
            className="-ml-2 h-11 w-11"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-extrabold leading-tight">
              {hasPlan ? "Start a new plan" : "Set up your exam plan"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Three quick steps. Aeva builds the day-by-day plan.
            </p>
          </div>
        </div>

        {hasPlan && (
          <div
            role="note"
            className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-sm"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              You already have an active plan. Starting over archives your
              current plan and its progress.
            </p>
          </div>
        )}

        <ExamSetupForm />
      </div>
    </PageContainer>
  );
}
