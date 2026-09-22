"use client";

import { DragEvent, useCallback, useState } from "react";
import Nav from "@/components/Nav";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FileSearch,
  FileText,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";

const CATEGORIES = [
  { value: "policy", label: "Policy", icon: FileCheck2 },
  { value: "evidence", label: "Evidence", icon: FileSearch },
  { value: "questionnaire", label: "Questionnaire", icon: ClipboardList },
];

type Status =
  | { type: "idle" }
  | { type: "uploading" }
  | { type: "success"; filename: string }
  | { type: "error"; message: string };

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("policy");
  const [notes, setNotes] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle" });

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  async function handleUpload() {
    if (!file) return;
    setStatus({ type: "uploading" });
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("category", category);
      if (notes) form.set("notes", notes);

      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to upload document");
      }

      setStatus({ type: "success", filename: file.name });
      setFile(null);
      setNotes("");
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-foreground">
          Upload document
        </h1>
        <p className="mb-8 text-sm text-muted">
          Add a policy, evidence file, or questionnaire to the library.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`mb-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
            dragging ? "border-accent bg-accent-soft" : "border-border bg-surface"
          }`}
        >
          {file ? (
            <div className="flex flex-col items-center">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <FileText size={20} />
              </span>
              <p className="max-w-xs truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</p>
              <button
                onClick={() => setFile(null)}
                className="mt-3 flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X size={12} />
                Remove
              </button>
            </div>
          ) : (
            <>
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <UploadCloud size={20} />
              </span>
              <p className="mb-3 text-sm text-muted">Drag and drop a file here, or</p>
              <label className="cursor-pointer rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover">
                Browse files
                <input
                  type="file"
                  accept=".docx,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.gif"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="mt-3 text-xs text-muted-2">.docx, .xlsx, .pdf, or images (max ~4MB)</p>
            </>
          )}
        </div>

        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-foreground">Category</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const selected = category === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
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
        </div>

        <div className="mb-7">
          <label className="mb-2 block text-sm font-medium text-foreground">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
            placeholder="Any context for this document..."
          />
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || status.type === "uploading"}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status.type === "uploading" && <Loader2 size={16} className="animate-spin" />}
          {status.type === "uploading" ? "Uploading & processing..." : "Upload"}
        </button>

        {status.type === "success" && (
          <p className="mt-4 flex items-center gap-2 text-sm text-success">
            <CheckCircle2 size={16} />
            Uploaded and processed &quot;{status.filename}&quot;.
          </p>
        )}
        {status.type === "error" && (
          <p className="mt-4 flex items-center gap-2 text-sm text-danger">
            <AlertCircle size={16} />
            {status.message}
          </p>
        )}
      </main>
    </div>
  );
}
