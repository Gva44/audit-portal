"use client";

import { MouseEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Highlighted from "@/components/Highlighted";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  FileCheck2,
  FileImage,
  FileSearch,
  FileText,
  FileX2,
  LayoutGrid,
  Search,
  Sparkles,
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
  snippet?: string;
};

type DocDetail = DocSummary & {
  extracted_text: string | null;
  extraction_error: string | null;
};

const CATEGORIES = [
  { value: "", label: "All", icon: LayoutGrid },
  { value: "policy", label: "Policy", icon: FileCheck2 },
  { value: "evidence", label: "Evidence", icon: FileSearch },
  { value: "questionnaire", label: "Questionnaire", icon: ClipboardList },
];

const CATEGORY_ICON: Record<string, typeof FileCheck2> = {
  policy: FileCheck2,
  evidence: FileSearch,
  questionnaire: ClipboardList,
};

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <FileImage size={17} />;
  return <FileText size={17} />;
}

export default function LibraryPage() {
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<DocDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
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
  }, [category, query]);

  useEffect(() => {
    const t = setTimeout(fetchDocuments, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchDocuments, query]);

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
  }

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-foreground">
          Document library
        </h1>
        <p className="mb-8 text-sm text-muted">
          Browse, filter, and search policies, evidence, and questionnaires.
        </p>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const selected = category === c.value;
              return (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    selected
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface text-muted hover:bg-surface-hover"
                  }`}
                >
                  <Icon size={14} />
                  {c.label}
                </button>
              );
            })}
          </div>
          <div className="relative sm:w-72">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-2"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search keyword or meaning..."
              className="w-full rounded-full border border-border bg-surface py-2 pl-9 pr-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
            />
          </div>
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
              {query || category ? "Try a different search or filter." : "Upload your first document to get started."}
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {documents.map((doc) => {
            const CategoryIcon = CATEGORY_ICON[doc.category] ?? FileCheck2;
            const expanded = expandedId === doc.id;
            return (
              <li
                key={doc.id}
                className="overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong"
              >
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
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <FileTypeIcon mimeType={doc.mime_type} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{doc.filename}</span>
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-muted">
                        <CategoryIcon size={11} />
                        {doc.category}
                      </span>
                      {doc.extraction_status === "failed" && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                          <AlertTriangle size={11} />
                          extraction failed
                        </span>
                      )}
                    </div>
                    {doc.notes && <p className="mt-1 truncate text-xs text-muted">{doc.notes}</p>}
                    {doc.snippet && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted">
                        <Highlighted text={doc.snippet} />
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-2">{new Date(doc.created_at).toLocaleString()}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {doc.category === "questionnaire" && (
                      <Link
                        href={`/questionnaires/${doc.id}`}
                        onClick={(e) => e.stopPropagation()}
                        title="View questions & answers"
                        className="rounded-lg p-2 text-muted transition-colors hover:bg-accent-soft hover:text-accent"
                      >
                        <Sparkles size={15} />
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
                      size={16}
                      className={`ml-1 text-muted-2 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border bg-background/60 px-4 py-3.5">
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
      </main>
    </div>
  );
}
