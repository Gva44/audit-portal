"use client";

import { MouseEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import Highlighted from "@/components/Highlighted";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  FileImage,
  FileSearch,
  FileText,
  FileX2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

type DocSummary = {
  id: string;
  filename: string;
  category: string;
  notes: string | null;
  mime_type: string;
  extraction_status: string;
  created_at: string;
  client_id: string | null;
  client_name: string | null;
  snippet?: string;
};

type DocDetail = DocSummary & {
  extracted_text: string | null;
  extraction_error: string | null;
};

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "policy", label: "Policy" },
  { value: "evidence", label: "Evidence" },
  { value: "questionnaire", label: "Questionnaire" },
];

const CATEGORY_LABEL: Record<string, string> = {
  policy: "Policy",
  evidence: "Evidence",
  questionnaire: "Questionnaire",
};

function FileTypeIcon({ doc }: { doc: DocSummary }) {
  if (doc.category === "questionnaire") return <FileSearch size={17} />;
  if (doc.mime_type.startsWith("image/")) return <FileImage size={17} />;
  return <FileText size={17} />;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function LibraryContent() {
  const searchParams = useSearchParams();
  const clientFilter = searchParams.get("client") ?? "all";
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<DocDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (clientFilter !== "all") params.set("client", clientFilter);
      if (query.trim()) {
        params.set("q", query.trim());
        const res = await fetch(`/api/search?${params.toString()}`);
        const data = await res.json();
        setDocuments(data.results ?? []);
      } else {
        const res = await fetch(`/api/documents?${params.toString()}`);
        const data = await res.json();
        setDocuments(data.documents ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [category, query, clientFilter]);

  const fetchCounts = useCallback(async () => {
    const res = await fetch(clientFilter === "all" ? `/api/documents` : `/api/documents?client=${clientFilter}`);
    const data = await res.json();
    const all: DocSummary[] = data.documents ?? [];
    const next: Record<string, number> = {};
    for (const doc of all) {
      next[doc.category] = (next[doc.category] ?? 0) + 1;
    }
    next[""] = all.length;
    setCounts(next);
  }, [clientFilter]);

  useEffect(() => {
    const t = setTimeout(fetchDocuments, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchDocuments, query]);

  useEffect(() => {
    const t = setTimeout(fetchCounts, 0);
    return () => clearTimeout(t);
  }, [fetchCounts]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDoc(null);
      return;
    }
    setExpandedId(id);
    setExpandedLoading(true);
    const res = await fetch(`/api/documents/${id}`);
    const data = await res.json();
    setExpandedDoc(data.document ?? null);
    setExpandedLoading(false);
  }

  async function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this document? This can't be undone.")) return;
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDoc(null);
    }
    fetchDocuments();
    fetchCounts();
  }

  return (
    <div className="min-h-screen bg-background md:pl-[232px]">
      <Nav />
      <main className="mx-auto flex max-w-5xl flex-col gap-7 px-6 py-10 md:px-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-foreground">Library</h1>
            <p className="mt-1.5 text-muted">Policies, evidence and questionnaires, organised by client.</p>
          </div>
          <Link
            href="/upload"
            className="flex items-center gap-2 rounded-[10px] bg-foreground px-4 py-2.5 text-sm font-semibold text-surface transition-opacity hover:opacity-90"
          >
            <Plus size={15} strokeWidth={2.2} />
            Upload document
          </Link>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-hover p-1">
            {CATEGORIES.map((c) => {
              const selected = category === c.value;
              const count = counts[c.value];
              return (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`rounded-[9px] px-3.5 py-1.5 text-sm transition-colors ${
                    selected
                      ? "bg-surface font-semibold text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                      : "font-medium text-muted hover:text-foreground"
                  }`}
                >
                  {c.label}
                  {typeof count === "number" && <span className="ml-1.5 font-medium text-muted-2">{count}</span>}
                </button>
              );
            })}
          </div>
          <label className="flex max-w-[340px] min-w-[260px] flex-1 items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-muted-2 focus-within:border-accent">
            <Search size={15} />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by keyword or meaning"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-2"
            />
            {!query && (
              <kbd className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-2">⌘K</kbd>
            )}
          </label>
        </div>

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
        )}

        {!loading && documents.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-hover text-muted-2">
              <FileX2 size={20} />
            </span>
            <p className="text-sm font-medium text-foreground">No documents found</p>
            <p className="mt-1 text-sm text-muted">
              {query || category || clientFilter !== "all"
                ? "Try a different search or filter."
                : "Upload your first document to get started."}
            </p>
          </div>
        )}

        {!loading && documents.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
            <div className="hidden items-center gap-4 border-b border-border bg-surface-hover px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2 sm:flex">
              <span className="flex-1">Document</span>
              <span className="w-24">Client</span>
              <span className="w-28">Type</span>
              <span className="w-24 text-right">Added</span>
              <span className="w-[176px]" />
            </div>
            <ul className="divide-y divide-border">
              {documents.map((doc) => {
                const expanded = expandedId === doc.id;
                return (
                  <li key={doc.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleExpand(doc.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleExpand(doc.id);
                        }
                      }}
                      className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-surface-hover/60"
                    >
                      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3.5">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
                            doc.category === "questionnaire"
                              ? "bg-accent-soft text-accent"
                              : "bg-surface-hover text-muted"
                          }`}
                        >
                          <FileTypeIcon doc={doc} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{doc.filename}</p>
                          {doc.snippet ? (
                            <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">
                              <Highlighted text={doc.snippet} />
                            </p>
                          ) : (
                            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                              {doc.extraction_status === "failed" ? (
                                <span className="flex items-center gap-1 text-danger">
                                  <AlertTriangle size={12} />
                                  Extraction failed
                                </span>
                              ) : (
                                (doc.notes ?? "Text extracted")
                              )}
                            </p>
                          )}
                        </div>
                      </div>

                      <span className="w-24">
                        <span
                          className={`inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            doc.client_name ? "bg-success-soft text-success" : "bg-surface-hover text-muted"
                          }`}
                        >
                          {doc.client_name ?? "General"}
                        </span>
                      </span>
                      <span className="w-28 text-sm text-muted">{CATEGORY_LABEL[doc.category] ?? doc.category}</span>
                      <span className="w-24 text-right text-sm text-muted">{formatDate(doc.created_at)}</span>

                      <div className="flex w-[176px] shrink-0 items-center justify-end gap-0.5">
                        {doc.category === "questionnaire" && (
                          <Link
                            href={`/questionnaires/${doc.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="mr-1 flex items-center gap-1.5 rounded-[9px] bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
                          >
                            Answer
                            <ArrowRight size={13} strokeWidth={2.2} />
                          </Link>
                        )}
                        <a
                          href={`/api/documents/${doc.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Open original file"
                          className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                        >
                          <ExternalLink size={15} />
                        </a>
                        <button
                          onClick={(e) => handleDelete(doc.id, e)}
                          title="Delete document"
                          className="rounded-lg p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 size={15} />
                        </button>
                        <ChevronDown
                          size={15}
                          className={`ml-0.5 text-muted-2 transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t border-border bg-background px-5 py-4">
                        {expandedLoading && <p className="text-xs text-muted">Loading extracted text...</p>}
                        {!expandedLoading && expandedDoc?.extraction_status === "failed" && (
                          <p className="flex items-center gap-1.5 text-xs text-danger">
                            <AlertTriangle size={13} />
                            Extraction failed: {expandedDoc.extraction_error}
                          </p>
                        )}
                        {!expandedLoading && expandedDoc?.extracted_text && (
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                            {expandedDoc.extracted_text}
                          </pre>
                        )}
                        {!expandedLoading &&
                          expandedDoc &&
                          !expandedDoc.extracted_text &&
                          expandedDoc.extraction_status === "ok" && (
                            <p className="text-xs text-muted">No text extracted.</p>
                          )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!loading && documents.length > 0 && (
          <p className="text-[13px] text-muted-2">
            Showing {documents.length} of {counts[""] ?? documents.length} documents
          </p>
        )}
      </main>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryContent />
    </Suspense>
  );
}
