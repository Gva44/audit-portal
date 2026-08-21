"use client";

import { DragEvent, useCallback, useState } from "react";
import Nav from "@/components/Nav";

const CATEGORIES = [
  { value: "policy", label: "Policy" },
  { value: "evidence", label: "Evidence" },
  { value: "questionnaire", label: "Questionnaire" },
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
    <div className="min-h-screen bg-neutral-50">
      <Nav />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-xl font-semibold text-neutral-900">Upload document</h1>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`mb-6 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragging ? "border-neutral-900 bg-neutral-100" : "border-neutral-300 bg-white"
          }`}
        >
          {file ? (
            <div>
              <p className="text-sm font-medium text-neutral-900">{file.name}</p>
              <p className="text-xs text-neutral-500">{(file.size / 1024).toFixed(1)} KB</p>
              <button onClick={() => setFile(null)} className="mt-2 text-xs text-neutral-500 underline">
                Remove
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2 text-sm text-neutral-600">Drag and drop a file here, or</p>
              <label className="cursor-pointer rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white">
                Browse files
                <input
                  type="file"
                  accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.gif"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="mt-2 text-xs text-neutral-400">.docx, .pdf, or images (max ~4MB)</p>
            </>
          )}
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-neutral-700">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6">
          <label className="mb-1 block text-sm font-medium text-neutral-700">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="Any context for this document..."
          />
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || status.type === "uploading"}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status.type === "uploading" ? "Uploading & processing..." : "Upload"}
        </button>

        {status.type === "success" && (
          <p className="mt-4 text-sm text-green-600">Uploaded and processed &quot;{status.filename}&quot;.</p>
        )}
        {status.type === "error" && <p className="mt-4 text-sm text-red-600">{status.message}</p>}
      </main>
    </div>
  );
}
