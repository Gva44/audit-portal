"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  History,
  Loader2,
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
};

type DocInfo = {
  id: string;
  filename: string;
  client_id: string | null;
  client_name: string | null;
  column_headers: string[] | null;
  column_config: ColumnConfig | null;
  column_instructions: string | null;
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

const COLUMN_FIELDS: { key: keyof ColumnConfig; label: string; hint: string }[] = [
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
  const [columnPicks, setColumnPicks] = useState<Record<keyof ColumnConfig, string>>({
    questionCol: "",
    evidenceCol: "",
    responseCol: "",
    commentsCol: "",
  });
  const [instructions, setInstructions] = useState("");
  const [rereading, setRereading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const compareStarted = useRef(false);

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

  async function generateOne(questionId: string) {
    setGeneratingIds((prev) => new Set(prev).add(questionId));
    try {
      const res = await fetch(`/api/questions/${questionId}/answer`, { method: "POST" });
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
    for (const questionId of ids) {
      await generateOne(questionId);
    }
  }

  async function generateAll() {
    setGeneratingAll(true);
    try {
      const pending = questions.filter((q) => q.answer_status !== "ok");
      await generateBatch(pending.map((q) => q.id));
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
        (q) => q.position + 1 >= from && q.position + 1 <= to && q.answer_status !== "ok"
      );
      await generateBatch(inRange.map((q) => q.id));
    } finally {
      setGeneratingRange(false);
    }
  }

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
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8 md:px-12">
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
                    generatingAll ||
                    generatingRange ||
                    questions.length === 0 ||
                    questions.every((q) => q.answer_status === "ok")
                  }
                  className="flex items-center gap-2 rounded-[10px] bg-foreground px-4 py-2.5 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingAll ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {generatingAll ? "Generating..." : "Generate all answers"}
                </button>
              </div>
            </header>

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

            {doc.column_headers && doc.column_headers.length > 0 && (
              <div className="rounded-[14px] border border-border bg-surface">
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
                  disabled={generatingAll || generatingRange}
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
                        onClick={() => generateOne(q.id)}
                        disabled={isGenerating || generatingAll || generatingRange}
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

                    {q.answer_status === "ok" && q.answer_text && (
                      <div className="mt-4 rounded-xl bg-surface-hover px-[18px] py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {q.response_value && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${responseBadgeClasses(q.response_value)}`}
                            >
                              {q.response_value}
                            </span>
                          )}
                          {band && score != null && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${band.classes}`}>
                              {score.toFixed(1)} / 10 · {band.label}
                            </span>
                          )}
                          {band && band.label !== "Ready" && (
                            <span className="flex items-center gap-1 rounded-full border border-danger-border bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                              <AlertTriangle size={10} />
                              Needs review
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-foreground">{q.answer_text}</p>
                        {q.comparison_note && (
                          <p className="mt-2 text-xs text-muted">
                            <span className="font-medium">What changed in the question:</span> {q.comparison_note}
                          </p>
                        )}
                        {q.recommendation && (
                          <p className="mt-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-foreground">
                            <span className="font-medium text-warning">Recommendation:</span> {q.recommendation}
                          </p>
                        )}
                        {q.suggested_action && (
                          <p className="mt-2 text-xs text-muted">
                            <span className="font-medium">Suggested action:</span> {q.suggested_action}
                          </p>
                        )}
                        {doc.client_id && q.source_scope === "general" && (
                          <p className="mt-2 text-xs text-muted">
                            Answered from General documents only — consider adding a {doc.client_name}-specific policy
                            or evidence for this.
                          </p>
                        )}
                        {q.citations.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {q.citations.map((c) => (
                              <a
                                key={c.id}
                                href={`/api/documents/${c.id}/file`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
                              >
                                <FileText size={11} />
                                {c.filename}
                                {c.scope === "general" && doc.client_id && (
                                  <span className="rounded bg-surface/60 px-1 text-[10px] uppercase">General</span>
                                )}
                                <ExternalLink size={10} />
                              </a>
                            ))}
                          </div>
                        )}
                        {q.generated_by && (
                          <p className="mt-2 text-xs text-muted-2">
                            Generated by {q.generated_by_display_name || q.generated_by}
                          </p>
                        )}
                      </div>
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
