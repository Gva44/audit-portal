"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  History,
  Loader2,
  Sparkles,
} from "lucide-react";

type Citation = { id: string; filename: string };

type Question = {
  id: string;
  document_id: string;
  position: number;
  question_text: string;
  row_data: Record<string, string> | null;
  answer_text: string | null;
  citations: Citation[];
  response_value: string | null;
  confidence_level: "high" | "medium" | "low" | null;
  // Postgres numeric columns are serialized as strings (avoids float precision loss).
  confidence_score: string | number | null;
  suggested_action: string | null;
  prior_question_id: string | null;
  prior_question_text: string | null;
  prior_document_filename: string | null;
  answer_status: "pending" | "generating" | "ok" | "failed";
  answer_error: string | null;
  created_at: string;
};

function responseBadgeClasses(value: string): string {
  const v = value.toLowerCase();
  if (v === "yes") return "bg-success-soft text-success";
  if (v === "no") return "bg-danger-soft text-danger";
  if (v === "na") return "bg-surface-hover text-muted";
  if (v === "partial") return "bg-warning-soft text-warning";
  return "bg-accent-soft text-accent"; // free-text (non yes/no/na/partial) answers
}

function confidenceBadgeClasses(level: string): string {
  if (level === "high") return "bg-success-soft text-success";
  if (level === "medium") return "bg-warning-soft text-warning";
  return "bg-danger-soft text-danger";
}

// Mirrors the heuristic in src/lib/questions.ts's findExpectedEvidence, for display only.
const EVIDENCE_HEADER_PATTERN = /evidence|document.*need|information.*need|required/i;

function findExpectedEvidence(rowData: Record<string, string> | null): string | null {
  if (!rowData) return null;
  for (const [header, value] of Object.entries(rowData)) {
    if (EVIDENCE_HEADER_PATTERN.test(header) && value.trim()) return value.trim();
  }
  return null;
}

type DocInfo = { id: string; filename: string };

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
  const [statusFilter, setStatusFilter] = useState<"all" | "needs_review" | "pending" | "answered">("all");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, questionsRes] = await Promise.all([
        fetch(`/api/documents/${id}`),
        fetch(`/api/documents/${id}/questions`),
      ]);
      const docData = await docRes.json();
      const questionsData = await questionsRes.json();
      setDoc(docData.document ?? null);
      setQuestions(questionsData.questions ?? []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(fetchAll, 0);
    return () => clearTimeout(t);
  }, [fetchAll]);

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

  const answeredCount = questions.filter((q) => q.answer_status === "ok").length;
  const needsReviewCount = questions.filter(
    (q) => q.answer_status === "ok" && q.confidence_level !== "high"
  ).length;
  const pendingCount = questions.filter((q) => q.answer_status !== "ok").length;

  const STATUS_FILTERS: { value: typeof statusFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: questions.length },
    { value: "needs_review", label: "Needs review", count: needsReviewCount },
    { value: "pending", label: "Pending", count: pendingCount },
    { value: "answered", label: "Answered", count: answeredCount },
  ];

  const visibleQuestions = questions.filter((q) => {
    if (statusFilter === "needs_review") return q.answer_status === "ok" && q.confidence_level !== "high";
    if (statusFilter === "pending") return q.answer_status !== "ok";
    if (statusFilter === "answered") return q.answer_status === "ok";
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/library"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back to library
        </Link>

        {loading && <p className="text-sm text-muted">Loading...</p>}

        {!loading && doc && (
          <>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{doc.filename}</h1>
                <p className="mt-1 text-sm text-muted">
                  {answeredCount} of {questions.length} questions answered
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a
                  href={`/api/documents/${id}/export`}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
                >
                  <Download size={16} />
                  Export to Excel
                </a>
                <button
                  onClick={generateAll}
                  disabled={
                    generatingAll ||
                    generatingRange ||
                    questions.length === 0 ||
                    questions.every((q) => q.answer_status === "ok")
                  }
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingAll ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {generatingAll ? "Generating..." : "Generate all answers"}
                </button>
              </div>
            </div>

            {questions.length > 0 && (
              <div className="mb-8 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3">
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
              <div className="mb-4 flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setStatusFilter(f.value)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      statusFilter === f.value
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border bg-surface text-muted hover:bg-surface-hover"
                    }`}
                  >
                    {f.label} ({f.count})
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

            <ul className="space-y-3">
              {visibleQuestions.map((q) => {
                const isGenerating = generatingIds.has(q.id);
                const expectedEvidence = findExpectedEvidence(q.row_data);
                return (
                  <li key={q.id} className="rounded-xl border border-border bg-surface p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="whitespace-pre-line text-sm font-medium text-foreground">
                          <span className="text-muted-2">{q.position + 1}.</span> {q.question_text}
                        </p>
                        {expectedEvidence && (
                          <p className="mt-1 text-xs text-muted">
                            <span className="font-medium">Evidence expected:</span> {expectedEvidence}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => generateOne(q.id)}
                        disabled={isGenerating || generatingAll || generatingRange}
                        className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isGenerating ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Sparkles size={12} />
                        )}
                        {q.answer_status === "ok" ? "Regenerate" : "Generate"}
                      </button>
                    </div>

                    {q.answer_status === "ok" && q.answer_text && (
                      <div className="mt-3 rounded-lg bg-background px-3.5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {q.response_value && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${responseBadgeClasses(q.response_value)}`}
                            >
                              {q.response_value}
                            </span>
                          )}
                          {q.confidence_level &&
                            (() => {
                              const score =
                                q.confidence_score != null ? Number(q.confidence_score) : null;
                              return (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClasses(q.confidence_level)}`}
                                >
                                  {q.confidence_level} confidence
                                  {score != null && !Number.isNaN(score) ? ` (${score.toFixed(2)})` : ""}
                                </span>
                              );
                            })()}
                          {q.confidence_level && q.confidence_level !== "high" && (
                            <span className="flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                              <AlertTriangle size={10} />
                              Needs review
                            </span>
                          )}
                          {q.prior_question_id && (
                            <span
                              className="flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-muted"
                              title={q.prior_question_text ? `Matched question: "${q.prior_question_text}"` : undefined}
                            >
                              <History size={10} />
                              Checked against{" "}
                              {q.prior_document_filename ? `"${q.prior_document_filename}"` : "a previous answer"}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-foreground">{q.answer_text}</p>
                        {q.suggested_action && (
                          <p className="mt-2 text-xs text-muted">
                            <span className="font-medium">Suggested action:</span> {q.suggested_action}
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
                                <ExternalLink size={10} />
                              </a>
                            ))}
                          </div>
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
