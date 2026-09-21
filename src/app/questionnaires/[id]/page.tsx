"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
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
  answer_status: "pending" | "generating" | "ok" | "failed";
  answer_error: string | null;
  created_at: string;
};

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

  async function generateAll() {
    setGeneratingAll(true);
    try {
      const pending = questions.filter((q) => q.answer_status !== "ok");
      for (const q of pending) {
        await generateOne(q.id);
      }
    } finally {
      setGeneratingAll(false);
    }
  }

  const answeredCount = questions.filter((q) => q.answer_status === "ok").length;

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
                  disabled={generatingAll || questions.length === 0 || questions.every((q) => q.answer_status === "ok")}
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingAll ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {generatingAll ? "Generating..." : "Generate all answers"}
                </button>
              </div>
            </div>

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

            <ul className="space-y-3">
              {questions.map((q) => {
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
                        disabled={isGenerating || generatingAll}
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
                        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                          <CheckCircle2 size={13} />
                          Answer
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{q.answer_text}</p>
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
