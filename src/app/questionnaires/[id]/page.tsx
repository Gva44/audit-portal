"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import { AnswerEditor, DocumentAssistant, QuestionAssistant } from "@/components/Assistant";
import AnswerSetup from "@/components/AnswerSetup";
import { asAllowed, clientResponse, resolveAllowed } from "@/lib/answer-format";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CheckCircle2,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  History,
  Loader2,
  Lock,
  RotateCcw,
  Settings2,
  Sparkles,
} from "lucide-react";

type Citation = { id: string; filename: string; scope?: "client" | "general" };
type ComparisonStatus = "same" | "reworded" | "changed" | "new";

type Question = {
  id: string;
  document_id: string;
  position: number;
  question_text: string;
  row_data: Record<string, string> | null;
  expected_evidence: string | null;
  answer_text: string | null;
  citations: Citation[];
  response_value: string | null;
  confidence_level: "high" | "medium" | "low" | null;
  // Postgres numeric columns are serialized as strings (avoids float precision loss).
  confidence_score: string | number | null;
  score: string | number | null;
  suggested_action: string | null;
  comparison_status: ComparisonStatus | null;
  comparison_note: string | null;
  recommendation: string | null;
  source_scope: "client" | "general" | "mixed" | null;
  prior_question_id: string | null;
  prior_question_text: string | null;
  prior_answer_text: string | null;
  prior_response_value: string | null;
  prior_document_filename: string | null;
  model_used: string | null;
  edited_by: string | null;
  edited_by_display_name: string | null;
  edited_at: string | null;
  previous_response_value: string | null;
  previous_answer_text: string | null;
  answer_format: "brief" | "short" | null;
  gap_note: string | null;
  documents_to_add: string[] | null;
  generated_by: string | null;
  generated_by_display_name: string | null;
  answer_status: "pending" | "generating" | "ok" | "failed";
  answer_error: string | null;
  created_at: string;
};

type ColumnConfig = {
  questionCol?: number | null;
  evidenceCol?: number | null;
  responseCol?: number | null;
  commentsCol?: number | null;
  citationsCol?: number | null;
  includeEvidence?: boolean;
};

type DocInfo = {
  id: string;
  filename: string;
  client_id: string | null;
  client_name: string | null;
  column_headers: string[] | null;
  column_config: ColumnConfig | null;
  column_instructions: string | null;
  answer_format: "brief" | "short";
  allowed_answers: string;
  columns_confirmed: boolean;
};

function responseBadgeClasses(value: string): string {
  const v = value.toLowerCase();
  if (v === "yes") return "border border-success-border bg-success-soft text-success";
  if (v === "no") return "border border-danger-border bg-danger-soft text-danger";
  if (v === "na") return "border border-neutral-border bg-surface-hover text-muted";
  if (v === "partial") return "border border-warning-border bg-warning-soft text-warning";
  return "bg-accent-soft text-accent"; // free-text (non yes/no/na/partial) answers
}

// 0-4 recheck, 5-7 partially there / update, 8-10 ready.
function scoreBand(score: number): { label: string; classes: string } {
  if (score >= 8) {
    return { label: "Ready", classes: "border border-success-border bg-success-soft text-success" };
  }
  if (score >= 5) {
    return { label: "Update", classes: "border border-warning-border bg-warning-soft text-warning" };
  }
  return { label: "Recheck", classes: "border border-danger-border bg-danger-soft text-danger" };
}

const COMPARISON_LABEL: Record<ComparisonStatus, { label: string; classes: string }> = {
  same: { label: "Same as last time", classes: "border border-success-border bg-success-soft text-success" },
  reworded: { label: "Reworded", classes: "border border-warning-border bg-warning-soft text-warning" },
  changed: { label: "Partly changed", classes: "border border-warning-border bg-warning-soft text-warning" },
  new: { label: "New question", classes: "border border-neutral-border bg-surface-hover text-muted" },
};

// Fallback for questions saved before expected_evidence was stored per row.
const EVIDENCE_HEADER_PATTERN = /evidence|document.*need|information.*need|required/i;

function expectedEvidenceOf(q: Question): string | null {
  if (q.expected_evidence) return q.expected_evidence;
  if (!q.row_data) return null;
  for (const [header, value] of Object.entries(q.row_data)) {
    if (EVIDENCE_HEADER_PATTERN.test(header) && value.trim()) return value.trim();
  }
  return null;
}

function scoreOf(q: Question): number | null {
  if (q.score == null) return null;
  const n = Number(q.score);
  return Number.isNaN(n) ? null : n;
}

type StatusFilter = "all" | "needs_review" | "pending" | "answered" | "differs";

const COLUMN_FIELDS: { key: "questionCol" | "evidenceCol" | "responseCol" | "commentsCol"; label: string; hint: string }[] = [
  { key: "questionCol", label: "Questions are in", hint: "Auto-detect" },
  { key: "evidenceCol", label: "Evidence expected is in", hint: "Auto-detect" },
  { key: "responseCol", label: "Write the response into", hint: "Add a new column" },
  { key: "commentsCol", label: "Write the comments into", hint: "Add a new column" },
];

export default function QuestionnairePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState("1");
  const [rangeTo, setRangeTo] = useState("20");
  const [generatingRange, setGeneratingRange] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [format, setFormat] = useState<"brief" | "short">("short");
  const [redoAnswered, setRedoAnswered] = useState(false);
  const [columnPicks, setColumnPicks] = useState<Record<"questionCol" | "evidenceCol" | "responseCol" | "commentsCol", string>>({
    questionCol: "",
    evidenceCol: "",
    responseCol: "",
    commentsCol: "",
  });
  const [instructions, setInstructions] = useState("");
  const [rereading, setRereading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const compareStarted = useRef(false);
  const [me, setMe] = useState<{ canGenerate: boolean; canAssist: boolean } | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) return;
        setMe({ canGenerate: !!d.user.canGenerate, canAssist: !!d.user.canAssist });
        if (!d.user.canGenerate) {
          setAiNotice("Answer generation is not enabled for your account right now. Ask an administrator if you need it.");
        }
      })
      .catch(() => undefined);
  }, []);
  const stopRequested = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [batch, setBatch] = useState<{ done: number; total: number; failed: number } | null>(null);

  const fetchQuestionsOnly = useCallback(async () => {
    const res = await fetch(`/api/documents/${id}/questions`);
    const data = await res.json();
    setQuestions(data.questions ?? []);
  }, [id]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, questionsRes] = await Promise.all([
        fetch(`/api/documents/${id}`),
        fetch(`/api/documents/${id}/questions`),
      ]);
      const docData = await docRes.json();
      const questionsData = await questionsRes.json();
      const d: DocInfo | null = docData.document ?? null;
      setDoc(d);
      setQuestions(questionsData.questions ?? []);
      if (d) {
        setFormat(d.answer_format === "brief" ? "brief" : "short");
        const cfg = d.column_config ?? {};
        const pick = (v: number | null | undefined) => (v == null ? "" : String(v));
        setColumnPicks({
          questionCol: pick(cfg.questionCol),
          evidenceCol: pick(cfg.evidenceCol),
          responseCol: pick(cfg.responseCol),
          commentsCol: pick(cfg.commentsCol),
        });
        setInstructions(d.column_instructions ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(fetchAll, 0);
    return () => clearTimeout(t);
  }, [fetchAll]);

  const runCompare = useCallback(async () => {
    setComparing(true);
    setCompareError(null);
    try {
      for (let guard = 0; guard < 40; guard++) {
        const res = await fetch(`/api/documents/${id}/compare`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Comparison failed");
        if (!data.comparable || data.remaining === 0) break;
      }
      await fetchQuestionsOnly();
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  }, [id, fetchQuestionsOnly]);

  // Compares with the client's earlier questionnaires automatically the first time the
  // page sees questions that haven't been compared yet.
  useEffect(() => {
    if (loading || compareStarted.current || !doc?.client_id) return;
    if (!questions.some((q) => q.comparison_status == null)) return;
    compareStarted.current = true;
    const t = setTimeout(runCompare, 0);
    return () => clearTimeout(t);
  }, [loading, doc, questions, runCompare]);

  async function chooseFormat(next: "brief" | "short") {
    setFormat(next);
    setDoc((d) => (d ? { ...d, answer_format: next } : d));
    await fetch(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answerFormat: next }),
    }).catch(() => {});
  }

  async function generateOne(questionId: string, withFormat?: "brief" | "short"): Promise<boolean> {
    setGeneratingIds((prev) => new Set(prev).add(questionId));
    try {
      const res = await fetch(`/api/questions/${questionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: withFormat ?? format }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.question) {
        setQuestions((prev) => prev.map((q) => (q.id === questionId ? data.question : q)));
      } else if (data.error) {
        setAiNotice(data.error);
      }
      return res.ok;
    } catch {
      return false;
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  }

  async function reuseLastAnswer(questionId: string) {
    setGeneratingIds((prev) => new Set(prev).add(questionId));
    try {
      const res = await fetch(`/api/questions/${questionId}/use-prior`, { method: "POST" });
      const data = await res.json();
      if (data.question) {
        setQuestions((prev) => prev.map((q) => (q.id === questionId ? data.question : q)));
      }
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  }

  async function extractQuestionsNow() {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(`/api/documents/${id}/extract-questions`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to extract questions");
      await fetchAll();
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Failed to extract questions");
    } finally {
      setExtracting(false);
    }
  }

  async function rereadQuestions(mode: "columns" | "instructions") {
    const answered = questions.filter((q) => q.answer_status === "ok").length;
    if (
      answered > 0 &&
      !confirm(`Re-reading the questions replaces the current list, including ${answered} answered. Continue?`)
    ) {
      return;
    }
    setRereading(true);
    setSetupError(null);
    try {
      const toIdx = (v: string) => (v === "" ? null : Number(v));
      const body =
        mode === "instructions"
          ? { instructions }
          : {
              config: {
                questionCol: toIdx(columnPicks.questionCol),
                evidenceCol: toIdx(columnPicks.evidenceCol),
                responseCol: toIdx(columnPicks.responseCol),
                commentsCol: toIdx(columnPicks.commentsCol),
              },
            };
      const res = await fetch(`/api/documents/${id}/reparse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not re-read the questions");
      compareStarted.current = false;
      await fetchAll();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Could not re-read the questions");
    } finally {
      setRereading(false);
    }
  }

  async function generateBatch(ids: string[]) {
    stopRequested.current = false;
    setStopping(false);
    setBatch({ done: 0, total: ids.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      if (stopRequested.current) break;
      const ok = await generateOne(ids[i]);
      if (!ok) failed++;
      setBatch({ done: i + 1, total: ids.length, failed });
    }
    // Leave the final tally visible briefly so a finished run is not just a vanishing bar.
    setTimeout(() => setBatch(null), 4000);
  }

  // Replacing answers that already exist needs a clear yes first. Each one keeps its previous
  // version, which "Restore previous answer" brings back.
  function confirmReplace(list: Question[]): boolean {
    if (!redoAnswered) return true;
    const existing = list.filter((q) => q.answer_status === "ok");
    if (existing.length === 0) return true;
    const edited = existing.filter((q) => q.edited_by).length;
    return confirm(
      `This will replace ${existing.length} existing ${existing.length === 1 ? "answer" : "answers"} with new ${format === "brief" ? "Brief" : "Short"} ones` +
        (edited > 0 ? `, including ${edited} you edited by hand` : "") +
        ". The previous version of each can be brought back with Restore previous answer. Continue?"
    );
  }

  async function generateAll() {
    const target = redoAnswered ? questions : questions.filter((q) => q.answer_status !== "ok");
    if (!confirmReplace(target)) return;
    setGeneratingAll(true);
    try {
      await generateBatch(target.map((q) => q.id));
    } finally {
      setGeneratingAll(false);
    }
  }

  async function generateRange() {
    const from = Number(rangeFrom);
    const to = Number(rangeTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) return;

    setGeneratingRange(true);
    try {
      // position is 0-indexed internally; the UI shows 1-indexed question numbers.
      const inRange = questions.filter(
        (q) => q.position + 1 >= from && q.position + 1 <= to && (redoAnswered || q.answer_status !== "ok")
      );
      if (!confirmReplace(inRange)) return;
      await generateBatch(inRange.map((q) => q.id));
    } finally {
      setGeneratingRange(false);
    }
  }

  const hasColumns = !!doc?.column_headers && doc.column_headers.length > 0;
  const allowedAnswers = resolveAllowed(
    asAllowed(doc?.allowed_answers),
    doc?.column_headers ?? null,
    doc?.column_config?.responseCol ?? null
  );
  const needsConfirm = hasColumns && !doc?.columns_confirmed;

  const isReady = (q: Question) => {
    const s = scoreOf(q);
    return s != null && s >= 8;
  };
  const answeredCount = questions.filter((q) => q.answer_status === "ok").length;
  const needsReviewCount = questions.filter((q) => q.answer_status === "ok" && !isReady(q)).length;
  const pendingCount = questions.filter((q) => q.answer_status !== "ok").length;
  const differsCount = questions.filter(
    (q) => q.comparison_status === "reworded" || q.comparison_status === "changed" || q.comparison_status === "new"
  ).length;
  const comparisonCounts = {
    same: questions.filter((q) => q.comparison_status === "same").length,
    reworded: questions.filter((q) => q.comparison_status === "reworded").length,
    changed: questions.filter((q) => q.comparison_status === "changed").length,
    new: questions.filter((q) => q.comparison_status === "new").length,
  };
  const hasComparison = questions.some((q) => q.comparison_status != null);
  const bandCounts = {
    ready: questions.filter((q) => q.answer_status === "ok" && (scoreOf(q) ?? -1) >= 8).length,
    update: questions.filter((q) => q.answer_status === "ok" && (scoreOf(q) ?? -1) >= 5 && (scoreOf(q) ?? -1) < 8)
      .length,
    recheck: questions.filter((q) => q.answer_status === "ok" && (scoreOf(q) ?? 99) < 5).length,
  };

  const STATUS_FILTERS: { value: StatusFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: questions.length },
    { value: "needs_review", label: "Needs review", count: needsReviewCount },
    { value: "pending", label: "Pending", count: pendingCount },
    { value: "answered", label: "Answered", count: answeredCount },
    ...(doc?.client_id && hasComparison && comparisonCounts.same + comparisonCounts.reworded + comparisonCounts.changed > 0
      ? [{ value: "differs" as StatusFilter, label: "Different from last time", count: differsCount }]
      : []),
  ];

  const visibleQuestions = questions.filter((q) => {
    if (statusFilter === "needs_review") return q.answer_status === "ok" && !isReady(q);
    if (statusFilter === "pending") return q.answer_status !== "ok";
    if (statusFilter === "answered") return q.answer_status === "ok";
    if (statusFilter === "differs") {
      return q.comparison_status === "reworded" || q.comparison_status === "changed" || q.comparison_status === "new";
    }
    return true;
  });

  const selectClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

  return (
    <div className="min-h-screen bg-background md:pl-[232px]">
      <Nav />
      <main className="flex flex-col gap-6 px-6 py-8 md:px-12">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-muted">
          <Link href="/library" className="transition-colors hover:text-foreground">
            Library
          </Link>
          <span className="text-muted-2">/</span>
          <span>{doc?.client_name ?? "General"}</span>
          <span className="text-muted-2">/</span>
          <span className="truncate font-semibold text-foreground">{doc?.filename ?? ""}</span>
        </nav>

        {loading && <p className="text-sm text-muted">Loading...</p>}

        {!loading && doc && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="truncate text-[28px] font-bold tracking-tight text-foreground">{doc.filename}</h1>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      doc.client_name ? "bg-success-soft text-success" : "bg-surface-hover text-muted"
                    }`}
                  >
                    {doc.client_name ?? "General"}
                  </span>
                </div>
                <div className="mt-3.5 flex items-center gap-3">
                  <div className="h-1.5 w-56 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-muted">
                    {answeredCount} of {questions.length} answered
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/documents/${id}/report`}
                  title="Internal report for the IT team: scores, last-time comparison, recommendations"
                  className="flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
                >
                  <ClipboardCheck size={15} />
                  IT review report
                </a>
                <a
                  href={`/api/documents/${id}/export`}
                  title="The client file with our answers filled in"
                  className="flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
                >
                  <Download size={15} />
                  Client file
                </a>
                <button
                  onClick={generateAll}
                  disabled={
                    needsConfirm ||
                    generatingAll ||
                    generatingRange ||
                    questions.length === 0 ||
                    (!redoAnswered && questions.every((q) => q.answer_status === "ok"))
                  }
                  className="flex items-center gap-2 rounded-[10px] bg-foreground px-4 py-2.5 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingAll ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {generatingAll ? "Generating..." : "Generate all answers"}
                </button>
              </div>
            </header>

            {batch && (
              <div
                className="rounded-[14px] border border-accent/30 bg-accent-soft p-5"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={batch.total}
                aria-valuenow={batch.done}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {batch.done < batch.total && !stopping ? (
                      <Loader2 size={15} className="animate-spin text-accent" />
                    ) : (
                      <CheckCircle2 size={15} className="text-success" />
                    )}
                    {batch.done < batch.total && !stopping
                      ? `Answering question ${Math.min(batch.done + 1, batch.total)} of ${batch.total}`
                      : stopping && batch.done < batch.total
                        ? `Stopped after ${batch.done} of ${batch.total}`
                        : `Finished ${batch.total} of ${batch.total}`}
                  </p>
                  {batch.done < batch.total && !stopping && (
                    <button
                      onClick={() => {
                        stopRequested.current = true;
                        setStopping(true);
                      }}
                      className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover"
                    >
                      Stop after this one
                    </button>
                  )}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${(batch.done / batch.total) * 100}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {batch.done} done
                  {batch.failed > 0 && <span className="text-danger"> · {batch.failed} failed (check the error on that question)</span>}
                  {batch.done < batch.total && !stopping && " · each answer takes a few seconds"}
                </p>
              </div>
            )}

            {(answeredCount > 0 || (doc.client_id && (comparing || hasComparison || compareError))) && (
              <section className="flex flex-wrap gap-4">
                {answeredCount > 0 && (
                  <div className="min-w-[280px] flex-1 rounded-[14px] border border-border bg-surface p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">Readiness</p>
                    <div className="my-3.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-border">
                      <div className="bg-[#2f9e6b]" style={{ flex: bandCounts.ready }} />
                      <div className="bg-[#e0a02b]" style={{ flex: bandCounts.update }} />
                      <div className="bg-[#d9534f]" style={{ flex: bandCounts.recheck }} />
                    </div>
                    <div className="flex flex-wrap gap-5">
                      {[
                        { n: bandCounts.ready, label: "Ready · 8–10" },
                        { n: bandCounts.update, label: "Update · 5–7" },
                        { n: bandCounts.recheck, label: "Recheck · 0–4" },
                      ].map((band) => (
                        <div key={band.label}>
                          <p className="text-[22px] font-bold tracking-tight text-foreground">{band.n}</p>
                          <p className="text-[13px] text-muted">{band.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {doc.client_id && (comparing || hasComparison || compareError) && (
                  <div className="min-w-[280px] flex-1 rounded-[14px] border border-border bg-surface p-5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">
                        Compared with last time
                      </p>
                      <button
                        onClick={() => {
                          compareStarted.current = true;
                          runCompare();
                        }}
                        disabled={comparing}
                        className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover disabled:opacity-50"
                      >
                        {comparing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        {comparing ? "Comparing..." : "Compare again"}
                      </button>
                    </div>
                    {hasComparison && comparisonCounts.same + comparisonCounts.reworded + comparisonCounts.changed > 0 ? (
                      <>
                        <div className="my-3.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-border">
                          <div className="bg-accent" style={{ flex: comparisonCounts.same }} />
                          <div className="bg-[#7d93d6]" style={{ flex: comparisonCounts.reworded }} />
                          <div className="bg-[#b9c5ea]" style={{ flex: comparisonCounts.changed }} />
                          <div className="bg-[#dfe3ec]" style={{ flex: comparisonCounts.new }} />
                        </div>
                        <div className="flex flex-wrap gap-5">
                          {(
                            [
                              ["same", "Same"],
                              ["reworded", "Reworded"],
                              ["changed", "Changed"],
                              ["new", "New"],
                            ] as [ComparisonStatus, string][]
                          ).map(([key, label]) => (
                            <div key={key}>
                              <p className="text-[22px] font-bold tracking-tight text-foreground">
                                {comparisonCounts[key]}
                              </p>
                              <p className="text-[13px] text-muted">{label}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      hasComparison && (
                        <p className="mt-3 text-sm text-muted">
                          No earlier answered questionnaire for {doc.client_name} to compare against yet, so every
                          question is new.
                        </p>
                      )
                    )}
                    {compareError && <p className="mt-2 text-xs text-danger">{compareError}</p>}
                  </div>
                )}
              </section>
            )}

            {aiNotice && (
              <p className="flex items-start gap-2 rounded-[14px] border border-warning-border bg-warning-soft px-4 py-3 text-sm text-foreground">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                {aiNotice}
              </p>
            )}

            {hasColumns && (
              <AnswerSetup
                key={`${doc.id}-${doc.columns_confirmed}`}
                documentId={id}
                headers={doc.column_headers!}
                config={doc.column_config}
                allowedAnswers={doc.allowed_answers}
                confirmed={doc.columns_confirmed}
                onSaved={(saved) =>
                  setDoc((d) =>
                    d
                      ? {
                          ...d,
                          column_config: { ...(d.column_config ?? {}), ...saved.column_config },
                          allowed_answers: saved.allowed_answers,
                          columns_confirmed: saved.columns_confirmed,
                        }
                      : d
                  )
                }
                onOpenColumnSetup={() => {
                  setSetupOpen(true);
                  setTimeout(() => document.getElementById("column-setup")?.scrollIntoView({ behavior: "smooth" }), 50);
                }}
              />
            )}

            {me?.canAssist && <DocumentAssistant documentId={id} answered={answeredCount} />}

            {doc.column_headers && doc.column_headers.length > 0 && (
              <div id="column-setup" className="rounded-[14px] border border-border bg-surface">
                <button
                  onClick={() => setSetupOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Settings2 size={14} />
                    Column setup
                    <span className="text-xs font-normal text-muted">which columns the questions and answers use</span>
                  </span>
                  <ChevronDown size={16} className={`text-muted-2 transition-transform ${setupOpen ? "rotate-180" : ""}`} />
                </button>
                {setupOpen && (
                  <div className="border-t border-border px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {COLUMN_FIELDS.map((f) => (
                        <div key={f.key}>
                          <label className="mb-1 block text-xs font-medium text-muted">{f.label}</label>
                          <select
                            value={columnPicks[f.key]}
                            onChange={(e) => setColumnPicks((p) => ({ ...p, [f.key]: e.target.value }))}
                            className={selectClass}
                          >
                            <option value="">{f.hint}</option>
                            {doc.column_headers!.map((h, i) => (
                              <option key={i} value={i}>
                                {String.fromCharCode(65 + (i % 26))} — {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => rereadQuestions("columns")}
                      disabled={rereading}
                      className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      {rereading && <Loader2 size={14} className="animate-spin" />}
                      Apply columns and re-read questions
                    </button>

                    <div className="mt-5 border-t border-border pt-4">
                      <label htmlFor="setup-instructions" className="mb-1 block text-xs font-medium text-muted">
                        Or describe it in words
                      </label>
                      <textarea
                        id="setup-instructions"
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        rows={2}
                        placeholder="e.g. Questions are in column C, ignore the first two rows, put the response in column F"
                        className={selectClass}
                      />
                      <button
                        onClick={() => rereadQuestions("instructions")}
                        disabled={rereading || !instructions.trim()}
                        className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
                      >
                        {rereading && <Loader2 size={14} className="animate-spin" />}
                        <Sparkles size={14} />
                        Read using my description
                      </button>
                    </div>
                    {setupError && <p className="mt-3 text-xs text-danger">{setupError}</p>}
                  </div>
                )}
              </div>
            )}

            {questions.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-border bg-surface px-4 py-3">
                <span className="text-sm font-medium text-foreground">Answer style</span>
                <div role="radiogroup" aria-label="Answer style" className="flex gap-1 rounded-xl bg-surface-hover p-1">
                  {(
                    [
                      ["brief", "Brief"],
                      ["short", "Short"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={format === value}
                      onClick={() => chooseFormat(value)}
                      className={`rounded-[9px] px-4 py-1.5 text-sm transition-colors ${
                        format === value
                          ? "bg-surface font-semibold text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                          : "font-medium text-muted hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted">
                  {format === "brief"
                    ? "One sentence with the specific control (about 15-25 words)."
                    : "One specific phrase (up to about 12 words), no bullets."}{" "}
                  Applies to answers generated from now on. Change it between runs to mix styles, for example 1-20
                  Brief and 21-40 Short.
                </span>
                <label className="flex w-full cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={redoAnswered}
                    onChange={(e) => setRedoAnswered(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  Also redo questions that already have an answer
                  <span className="text-xs text-muted">
                    (for Generate all answers and Generate range; the old version can be restored)
                  </span>
                </label>
              </div>
            )}

            {questions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-surface px-4 py-3">
                <span className="text-sm text-muted">Or generate just questions</span>
                <input
                  type="number"
                  min={1}
                  max={questions.length}
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-sm text-foreground outline-none focus:border-accent"
                />
                <span className="text-sm text-muted">to</span>
                <input
                  type="number"
                  min={1}
                  max={questions.length}
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-sm text-foreground outline-none focus:border-accent"
                />
                <span className="text-sm text-muted">of {questions.length}</span>
                <button
                  onClick={generateRange}
                  disabled={needsConfirm || generatingAll || generatingRange}
                  className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingRange ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {generatingRange ? "Generating..." : "Generate range"}
                </button>
              </div>
            )}

            {questions.length > 0 && (
              <div className="flex flex-wrap gap-1 self-start rounded-xl bg-surface-hover p-1">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setStatusFilter(f.value)}
                    className={`rounded-[9px] px-3.5 py-1.5 text-sm transition-colors ${
                      statusFilter === f.value
                        ? "bg-surface font-semibold text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                        : "font-medium text-muted hover:text-foreground"
                    }`}
                  >
                    {f.label} <span className="ml-1 font-medium text-muted-2">{f.count}</span>
                  </button>
                ))}
              </div>
            )}

            {questions.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-hover text-muted-2">
                  <FileSearch size={18} />
                </span>
                <p className="text-sm text-muted">No questions have been extracted from this document yet.</p>
                <button
                  onClick={extractQuestionsNow}
                  disabled={extracting}
                  className="mt-3 flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {extracting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {extracting ? "Extracting..." : "Extract questions"}
                </button>
                {extractError && <p className="mt-2 text-xs text-danger">{extractError}</p>}
              </div>
            )}

            {questions.length > 0 && visibleQuestions.length === 0 && (
              <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
                No questions match this filter.
              </p>
            )}

            <ul className="flex flex-col gap-4">
              {visibleQuestions.map((q) => {
                const isGenerating = generatingIds.has(q.id);
                const expectedEvidence = expectedEvidenceOf(q);
                const score = scoreOf(q);
                const band = score != null ? scoreBand(score) : null;
                const cmp = q.comparison_status ? COMPARISON_LABEL[q.comparison_status] : null;
                const canReuse = q.prior_question_id && q.prior_answer_text;
                return (
                  <li key={q.id} className="rounded-2xl border border-border bg-surface p-6">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="whitespace-pre-line text-[15px] font-semibold leading-relaxed text-foreground">
                          <span className="mr-2 font-mono text-xs font-medium text-muted-2">{String(q.position + 1).padStart(2, "0")}</span> {q.question_text}
                        </p>
                        {expectedEvidence && (
                          <p className="mt-1 text-xs text-muted">
                            <span className="font-medium">Evidence expected:</span> {expectedEvidence}
                          </p>
                        )}
                        {cmp && doc.client_id && (
                          <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cmp.classes}`}>
                            {cmp.label}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (
                            q.edited_by &&
                            !confirm(
                              "This answer was edited by hand. Regenerating replaces it with a new AI answer. You can bring it back with Restore previous answer. Continue?"
                            )
                          ) {
                            return;
                          }
                          generateOne(q.id);
                        }}
                        disabled={needsConfirm || isGenerating || generatingAll || generatingRange}
                        className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {q.answer_status === "ok" ? "Regenerate" : "Generate"}
                      </button>
                    </div>

                    {q.prior_question_id && q.prior_answer_text && (
                      <div className="mt-3 rounded-xl border border-dashed border-border-strong px-[18px] py-3.5">
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                          <History size={11} />
                          Last time
                          {q.prior_document_filename ? ` (${q.prior_document_filename})` : ""}
                          {q.prior_response_value && (
                            <span
                              className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${responseBadgeClasses(q.prior_response_value)}`}
                            >
                              {q.prior_response_value}
                            </span>
                          )}
                        </p>
                        {q.prior_question_text && q.comparison_status !== "same" && (
                          <p className="mb-1 text-xs text-muted">
                            <span className="font-medium">They asked:</span> {q.prior_question_text}
                          </p>
                        )}
                        <p className="text-xs leading-relaxed text-foreground">{q.prior_answer_text}</p>
                        {canReuse && (
                          <button
                            onClick={() => reuseLastAnswer(q.id)}
                            disabled={isGenerating}
                            className="mt-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
                          >
                            Use last time&apos;s answer
                          </button>
                        )}
                      </div>
                    )}

                    {q.answer_status === "ok" && (q.answer_text || q.response_value) && (
                      <div className="mt-4 flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {q.response_value && (
                            <span
                              title="The full answer, for your team. The client file may show something different."
                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${responseBadgeClasses(q.response_value)}`}
                            >
                              {q.response_value}
                            </span>
                          )}
                          {q.response_value &&
                            clientResponse(q.response_value, allowedAnswers) !== q.response_value && (
                              <span
                                title="What goes into the client's Yes/No column. The IT review report keeps the full answer."
                                className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-muted"
                              >
                                Client file: {clientResponse(q.response_value, allowedAnswers) || "left empty"}
                              </span>
                            )}
                          {band && score != null && (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${band.classes}`}>
                              {score.toFixed(1)} / 10 · {band.label}
                            </span>
                          )}
                          {band && band.label !== "Ready" && (
                            <span className="flex items-center gap-1 rounded-full border border-danger-border bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">
                              <AlertTriangle size={10} />
                              Needs review
                            </span>
                          )}
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-muted">Answer style</span>
                            <div
                              role="radiogroup"
                              aria-label="Answer style for this question"
                              className="flex gap-0.5 rounded-[10px] bg-surface-hover p-[3px]"
                            >
                              {(
                                [
                                  ["brief", "Brief"],
                                  ["short", "Short"],
                                ] as const
                              ).map(([value, label]) => {
                                const active = q.answer_format === value;
                                return (
                                  <button
                                    key={value}
                                    role="radio"
                                    aria-checked={active}
                                    disabled={needsConfirm || isGenerating || generatingAll || generatingRange}
                                    title={active ? `This answer is in the ${label} style` : `Rewrite this answer in the ${label} style`}
                                    onClick={() => {
                                      if (active) return;
                                      if (
                                        q.edited_by &&
                                        !confirm(
                                          "This answer was edited by hand. Switching style regenerates it. You can bring your version back with Restore previous answer. Continue?"
                                        )
                                      ) {
                                        return;
                                      }
                                      generateOne(q.id, value);
                                    }}
                                    className={`rounded-lg px-3.5 py-1 text-[13px] transition-colors disabled:cursor-not-allowed ${
                                      active
                                        ? "bg-surface font-bold text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]"
                                        : "font-medium text-muted hover:text-foreground disabled:opacity-50"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="grid items-stretch gap-4 lg:grid-cols-2">
                          <section className="flex flex-col gap-4 rounded-2xl border-[1.5px] border-success-border bg-success-soft/40 p-5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="flex items-center gap-2 text-[15px] font-bold text-success">
                                <Check size={17} strokeWidth={2.4} />
                                Answer for the client
                              </h3>
                              <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
                                Goes into the client file
                              </span>
                            </div>

                            {(q.response_value ?? "").toLowerCase() === "na" && (
                              <p className="flex items-start gap-1.5 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-foreground">
                                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" />
                                <span>
                                  <span className="font-medium text-warning">May not apply.</span> Please confirm with IT.
                                  The remark below is a draft N/A for the client.
                                </span>
                              </p>
                            )}

                            <div className="flex flex-col gap-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Yes / No column</span>
                              {clientResponse(q.response_value, allowedAnswers) ? (
                                <span className="self-start rounded-[10px] bg-success px-[18px] py-1 text-lg font-bold text-surface">
                                  {clientResponse(q.response_value, allowedAnswers)}
                                </span>
                              ) : (
                                <span className="self-start rounded-[10px] border border-dashed border-border-strong px-4 py-1 text-sm font-semibold text-muted">
                                  Left empty
                                </span>
                              )}
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Remark</span>
                              {(q.response_value ?? "").toLowerCase() === "no" && !q.answer_text ? (
                                <p className="flex items-start gap-1.5 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-xs text-foreground">
                                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-danger" />
                                  <span>
                                    <span className="font-medium text-danger">Needs IT input.</span> Nothing related was
                                    found in the documents, so the client file is left empty for this one. Write the
                                    answer with Edit answer.
                                  </span>
                                </p>
                              ) : (
                                <p className="whitespace-pre-line rounded-xl border border-success-border bg-surface px-4 py-3 text-base font-medium leading-relaxed text-foreground">
                                  {q.answer_text}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-col gap-2">
                              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                                Evidence column: documents used
                              </span>
                              {q.citations.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {q.citations.map((c) => (
                                    <a
                                      key={c.id}
                                      href={`/api/documents/${c.id}/file`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-1 rounded-full border border-success-border bg-surface px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
                                    >
                                      <FileText size={11} />
                                      {c.filename}
                                      {c.scope === "general" && doc.client_id && (
                                        <span className="rounded bg-surface-hover px-1 text-[10px] uppercase text-muted">General</span>
                                      )}
                                      <ExternalLink size={10} />
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted">No documents were used.</span>
                              )}
                              {doc.client_id && q.source_scope === "general" && (
                                <span className="text-xs text-muted">
                                  All General documents. Nothing {doc.client_name}-specific yet.
                                </span>
                              )}
                            </div>

                            <div className="mt-auto flex flex-col gap-1">
                              {me && (me.canGenerate || me.canAssist) && (
                                <AnswerEditor
                                  questionId={q.id}
                                  responseValue={q.response_value}
                                  answerText={q.answer_text}
                                  canRestore={!!q.previous_answer_text}
                                  editedBy={q.edited_by ? (q.edited_by_display_name ?? q.edited_by) : null}
                                  editedAt={q.edited_at}
                                  onQuestionUpdated={(updated) =>
                                    setQuestions((prev) => prev.map((x) => (x.id === q.id ? (updated as Question) : x)))
                                  }
                                />
                              )}
                              {q.generated_by && (
                                <p className="text-xs text-muted-2">
                                  Generated by {q.generated_by_display_name || q.generated_by}
                                  {q.model_used?.includes("backup") && " · answered by the Gemini backup (DeepSeek was busy)"}
                                </p>
                              )}
                            </div>
                          </section>

                          <section className="flex flex-col gap-4 rounded-2xl border-[1.5px] border-dashed border-border-strong bg-surface-hover p-5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                                <Lock size={16} strokeWidth={2.2} />
                                For your team only
                              </h3>
                              <span className="rounded-full bg-border px-2.5 py-0.5 text-xs font-semibold text-muted">
                                Never sent to the client
                              </span>
                            </div>

                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">1. What is missing</span>
                              <p className="text-[13.5px] leading-relaxed text-foreground">
                                {q.gap_note ||
                                  (q.recommendation
                                    ? "No gap found against what the client asked. See the recommendation to strengthen the evidence."
                                    : "Nothing missing: the documents fully support this answer.")}
                              </p>
                              {q.comparison_note && (
                                <p className="text-xs text-muted">
                                  <span className="font-medium">What changed in the question:</span> {q.comparison_note}
                                </p>
                              )}
                            </div>

                            {q.recommendation && (
                              <div className="flex flex-col gap-1 rounded-xl bg-warning-soft px-3.5 py-3">
                                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-warning">2. Recommendation</span>
                                <p className="text-[13.5px] leading-relaxed text-foreground">{q.recommendation}</p>
                              </div>
                            )}

                            {q.suggested_action && (
                              <div className="flex flex-col gap-1">
                                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">3. Next step</span>
                                <p className="text-[13.5px] leading-relaxed text-foreground">{q.suggested_action}</p>
                              </div>
                            )}

                            {q.documents_to_add && q.documents_to_add.length > 0 && (
                              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3.5 py-3">
                                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
                                  4. Documents to add to close the gap
                                </span>
                                {q.documents_to_add.map((d, i) => (
                                  <div key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-foreground">
                                    <span className="font-bold text-accent">+</span>
                                    <span>{d}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        </div>
                      </div>
                    )}

                    {me?.canAssist && q.answer_status === "ok" && (
                      <QuestionAssistant
                        questionId={q.id}
                        citations={q.citations}
                        onQuestionUpdated={(updated) =>
                          setQuestions((prev) => prev.map((x) => (x.id === q.id ? (updated as Question) : x)))
                        }
                      />
                    )}

                    {q.answer_status === "failed" && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                        <AlertTriangle size={13} />
                        {q.answer_error || "Failed to generate an answer"}
                      </p>
                    )}

                    {q.answer_status === "pending" && !isGenerating && (
                      <p className="mt-2 text-xs text-muted-2">Not yet answered.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
