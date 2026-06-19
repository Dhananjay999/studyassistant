import { useState } from "react";
import { CheckCircle2, XCircle, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiService } from "@/services";
import type { QuizContent, QuizEvaluation, QuizFeedback } from "@/types";

interface QuizPanelProps {
  quiz: QuizContent;
  onSubmitted?: (result: {
    evaluation: QuizEvaluation;
    feedback: QuizFeedback;
  }) => void;
}

function formatAnswers(values: string[]) {
  return values.length ? values.join(", ") : "—";
}

function QuizResultsMatrix({
  quiz,
  evaluation,
}: {
  quiz: QuizContent;
  evaluation: QuizEvaluation;
}) {
  const questionMap = Object.fromEntries(quiz.questions.map((q) => [q.id, q]));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-violet-500" />
        <p className="text-sm font-semibold">Results matrix</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Your answer</TableHead>
              <TableHead>Correct</TableHead>
              <TableHead className="w-16 text-center">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evaluation.per_question.map((row, idx) => {
              const q = questionMap[row.question_id];
              return (
                <TableRow
                  key={row.question_id}
                  className={
                    row.is_correct
                      ? "bg-emerald-500/5"
                      : "bg-red-500/5"
                  }
                >
                  <TableCell className="font-medium">{idx + 1}</TableCell>
                  <TableCell className="max-w-[200px] text-xs">
                    {q?.prompt ?? row.question_id}
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatAnswers(row.user_answer)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatAnswers(row.correct_answer)}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.is_correct ? (
                      <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="mx-auto h-4 w-4 text-red-500" />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function QuizDetailedAnalysis({
  quiz,
  feedback,
}: {
  quiz: QuizContent;
  feedback: QuizFeedback;
}) {
  const questionMap = Object.fromEntries(quiz.questions.map((q) => [q.id, q]));
  const explanationMap = Object.fromEntries(
    feedback.per_question.map((p) => [p.question_id, p.explanation]),
  );

  return (
    <div className="space-y-3 border-t border-border/40 pt-3">
      <p className="text-sm font-semibold">Detailed analysis</p>
      <p className="text-sm text-muted-foreground">{feedback.summary}</p>

      {feedback.weak_topics.length > 0 && (
        <div>
          <p className="text-xs font-medium opacity-70">Weak topics</p>
          <ul className="list-inside list-disc text-xs">
            {feedback.weak_topics.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {feedback.recommendations.length > 0 && (
        <div>
          <p className="text-xs font-medium opacity-70">Recommendations</p>
          <ul className="list-inside list-disc text-xs">
            {feedback.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {feedback.per_question.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium opacity-70">Per-question notes</p>
          {feedback.per_question.map((pq, idx) => (
            <div
              key={pq.question_id}
              className="rounded-md bg-muted/50 px-2 py-1.5 text-xs"
            >
              <span className="font-medium">Q{idx + 1}. </span>
              {questionMap[pq.question_id]?.prompt && (
                <span className="opacity-80">
                  {questionMap[pq.question_id].prompt} —{" "}
                </span>
              )}
              {explanationMap[pq.question_id]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuizPanel({ quiz, onSubmitted }: QuizPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [result, setResult] = useState<{
    evaluation: QuizEvaluation;
    feedback: QuizFeedback;
  } | null>(null);

  const setSingle = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: [value] }));
  };

  const toggleMulti = (qid: string, value: string) => {
    setAnswers((prev) => {
      const current = prev[qid] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [qid]: next };
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setShowAnalysis(false);
    try {
      const res = await apiService.submitQuiz(quiz.quiz_id, answers);
      setResult({
        evaluation: res.data.evaluation,
        feedback: res.data.feedback,
      });
      onSubmitted?.({
        evaluation: res.data.evaluation,
        feedback: res.data.feedback,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="mt-3 space-y-3 rounded-xl border border-border/50 bg-background/50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">
            Score: {result.evaluation.score}% (
            {result.evaluation.correct_count}/{result.evaluation.total} correct)
          </p>
        </div>

        <QuizResultsMatrix quiz={quiz} evaluation={result.evaluation} />

        {!showAnalysis ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setShowAnalysis(true)}
          >
            View detailed analysis
          </Button>
        ) : (
          <QuizDetailedAnalysis quiz={quiz} feedback={result.feedback} />
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
      <p className="text-sm font-semibold">{quiz.title}</p>
      {quiz.questions.map((q, idx) => (
        <div key={q.id} className="space-y-2">
          <p className="text-sm">
            {idx + 1}. {q.prompt}
          </p>
          {q.type === "single_select" || q.type === "true_false" ? (
            <RadioGroup
              value={answers[q.id]?.[0] || ""}
              onValueChange={(v) => setSingle(q.id, v)}
            >
              {q.options.map((opt) => (
                <div key={opt} className="flex items-center gap-2">
                  <RadioGroupItem value={opt} id={`${q.id}-${opt}`} />
                  <Label htmlFor={`${q.id}-${opt}`} className="text-sm">
                    {opt}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <div className="space-y-1">
              {q.options.map((opt) => (
                <div key={opt} className="flex items-center gap-2">
                  <Checkbox
                    checked={(answers[q.id] || []).includes(opt)}
                    onCheckedChange={() => toggleMulti(q.id, opt)}
                    id={`${q.id}-${opt}`}
                  />
                  <Label htmlFor={`${q.id}-${opt}`} className="text-sm">
                    {opt}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <Button size="sm" onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting..." : "Submit quiz"}
      </Button>
    </div>
  );
}
