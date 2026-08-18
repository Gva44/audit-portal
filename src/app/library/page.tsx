"use client";

import { MouseEvent, useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Highlighted from "@/components/Highlighted";

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
  { value: "", label: "All" },
  { value: "policy", label: "Policy" },
  { value: "evidence", label: "Evidence" },
  { value: "questionnaire", label: "Questionnaire" },
];

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
    <div className="min-h-screen bg-neutral-50">
      <Nav />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="mb-6 text-xl font-semibold text-neutral-900">Document library</h1>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  category === c.value
                    ? "bg-neutral-900 text-white"
                    : "border border-neutral-300 bg-white text-neutral-600"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keyword or meaning..."
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm sm:w-72"
          />
        </div>

        {loading && <p className="text-sm text-neutral-400">Loading...</p>}
        {!loading && documents.length === 0 && <p className="text-sm text-neutral-400">No documents found.</p>}

        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-neutral-200 bg-white">
              <button
                onClick={() => toggleExpand(doc.id)}
                className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-neutral-900">{doc.filename}</span>
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                      {doc.category}
                    </span>
                    {doc.extraction_status === "failed" && (
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                        extraction failed
                      </span>
                    )}
                  </div>
                  {doc.notes && <p className="mt-1 truncate text-xs text-neutral-500">{doc.notes}</p>}
                  {doc.snippet && (
                    <p className="mt-1 text-xs text-neutral-500">
                      <Highlighted text={doc.snippet} />
                    </p>
                  )}
                  <p className="mt-1 text-xs text-neutral-400">{new Date(doc.created_at).toLocaleString()}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <a
                    href={`/api/documents/${doc.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-medium text-neutral-600 underline"
                  >
                    Open file
                  </a>
                  <button onClick={(e) => handleDelete(doc.id, e)} className="text-xs font-medium text-red-500">
                    Delete
                  </button>
                </div>
              </button>

              {expandedId === doc.id && (
                <div className="border-t border-neutral-100 px-4 py-3">
                  {expandedLoading && <p className="text-xs text-neutral-400">Loading extracted text...</p>}
                  {!expandedLoading && expandedDoc?.extraction_status === "failed" && (
                    <p className="text-xs text-red-500">Extraction failed: {expandedDoc.extraction_error}</p>
                  )}
                  {!expandedLoading && expandedDoc?.extracted_text && (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-neutral-700">
                      {expandedDoc.extracted_text}
                    </pre>
                  )}
                  {!expandedLoading &&
                    expandedDoc &&
                    !expandedDoc.extracted_text &&
                    expandedDoc.extraction_status === "ok" && (
                      <p className="text-xs text-neutral-400">No text extracted.</p>
                    )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
