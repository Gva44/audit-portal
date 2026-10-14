"use client";

import { DragEvent, useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FileImage,
  FileSearch,
  FileText,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";

const NOTES_MAX_LENGTH = 500;

const CATEGORIES = [
  { value: "policy", label: "Policy", icon: FileCheck2, description: "Internal policies & standards" },
  { value: "evidence", label: "Evidence", icon: FileSearch, description: "Certifications, reports, screenshots" },
  { value: "questionnaire", label: "Questionnaire", icon: ClipboardList, description: "Bank/vendor DDQ to answer" },
];

type Status =
  | { type: "idle" }
  | { type: "uploading"; percent: number; phase: "sending" | "processing" }
  | { type: "success"; filename: string; warning?: string | null }
  | { type: "error"; message: string };

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("policy");
  const [notes, setNotes] = useState("");
  const [dragging, setDragging] = useState(false);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState("general");
  const [columnInstructions, setColumnInstructions] = useState("");
  const [status, setStatus] = useState<Status>({ type: "idle" });

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setClients(d.clients ?? []))
      .catch(() => setClients([]));
  }, []);

  async function handleUpload() {
    if (!file) return;
    setStatus({ type: "uploading", percent: 0, phase: "sending" });
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("category", category);
      if (notes) form.set("notes", notes);
      form.set("clientId", clientId);
      if (category === "questionnaire" && columnInstructions.trim()) {
        form.set("columnInstructions", columnInstructions.trim());
      }

      // XMLHttpRequest rather than fetch: only it reports how much of the file has been sent.
      const body = await new Promise<{ warning?: string | null }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setStatus({ type: "uploading", percent: Math.round((e.loaded / e.total) * 100), phase: "sending" });
          }
        };
        // The file is fully sent; the server is now storing, reading and indexing it.
        xhr.upload.onload = () => setStatus({ type: "uploading", percent: 100, phase: "processing" });
        xhr.onerror = () => reject(new Error("Network error while uploading"));
        xhr.onload = () => {
          let parsed: { error?: string; warning?: string | null } = {};
          try {
            parsed = JSON.parse(xhr.responseText);
          } catch {
            // non-JSON error page (e.g. a platform size limit); handled below
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
          else reject(new Error(parsed.error || `Upload failed (${xhr.status})`));
        };
        xhr.send(form);
      });

      setStatus({ type: "success", filename: file.name, warning: body.warning ?? null });
      setFile(null);
      setNotes("");
      setColumnInstructions("");
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    }
  }

  return (
    <div className="min-h-screen bg-background md:pl-[232px]">
      <Nav />
      <main className="flex flex-col gap-7 px-6 py-10 md:px-12">
        <header>
          <h1 className="text-[28px] font-bold tracking-tight text-foreground">Upload document</h1>
          <p className="mt-1.5 text-muted">Add a policy, evidence file, or questionnaire to the library.</p>
        </header>

        <div className="grid items-stretch gap-6 xl:grid-cols-2">
          <div className="flex flex-col rounded-[14px] border border-border bg-surface p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex min-h-[320px] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-border bg-background"
            }`}
          >
            {file ? (
              <div className="flex flex-col items-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  {file.type.startsWith("image/") ? <FileImage size={20} /> : <FileText size={20} />}
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
          </div>

          <div className="rounded-[14px] border border-border bg-surface p-6">
          <div className="mb-5">
            <label htmlFor="upload-client" className="mb-2 block text-sm font-medium text-foreground">
              Client
            </label>
            <select
              id="upload-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-accent"
            >
              <option value="general">General (available to every client)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-2">
              Client documents are used first when answering that client&apos;s questionnaires, then General ones.
            </p>
          </div>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-foreground">Category</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const selected = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`flex flex-col items-start gap-1 rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                      selected
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border bg-background text-muted hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon size={14} />
                      {c.label}
                    </span>
                    <span className={`text-xs font-normal ${selected ? "text-accent" : "text-muted-2"}`}>
                      {c.description}
                    </span>
                  </button>
                );
              })}
            </div>
            {category === "questionnaire" && (
              <p className="mt-2 text-xs text-muted-2">
                Tip: keep the original row structure in Excel or Word — it&apos;s used to automatically match questions to answers.
              </p>
            )}
          </div>

          {category === "questionnaire" && (
            <div className="mb-5">
              <label htmlFor="column-instructions" className="mb-2 block text-sm font-medium text-foreground">
                Which columns should be read? (optional)
              </label>
              <textarea
                id="column-instructions"
                value={columnInstructions}
                onChange={(e) => setColumnInstructions(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
                placeholder="e.g. Questions are in column C, evidence needed is in D, write the response in F and comments in G. Use the sheet called 'Section 2'."
              />
              <p className="mt-1.5 text-xs text-muted-2">
                Leave blank to detect columns automatically. You can review and change the columns after uploading.
              </p>
            </div>
          )}

          <div className="mb-7">
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-foreground">Notes (optional)</label>
              <span className="text-xs text-muted-2">
                {notes.length} / {NOTES_MAX_LENGTH}
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX_LENGTH))}
              maxLength={NOTES_MAX_LENGTH}
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
              placeholder="Any context for this document..."
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={!file || status.type === "uploading"}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.type === "uploading" && <Loader2 size={16} className="animate-spin" />}
            {status.type === "uploading"
              ? status.phase === "sending"
                ? `Uploading ${status.percent}%`
                : "Processing..."
              : "Upload"}
          </button>

          {status.type === "uploading" && (
            <div className="mt-4" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.percent}>
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                {status.phase === "sending" ? (
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${status.percent}%` }} />
                ) : (
                  <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
                )}
              </div>
              <p className="mt-2 text-xs text-muted">
                {status.phase === "sending"
                  ? "Sending the file..."
                  : "Saving to Drive, reading the text and indexing it for search. This can take a little while for PDFs and images."}
              </p>
            </div>
          )}
          </div>
        </div>

        {status.type === "success" && (
          <p className="mt-4 flex items-center gap-2 text-sm text-success">
            <CheckCircle2 size={16} />
            Uploaded and processed &quot;{status.filename}&quot;.
          </p>
        )}
        {status.type === "success" && status.warning && (
          <p className="mt-2 flex items-center gap-2 text-sm text-warning">
            <AlertCircle size={16} />
            {status.warning}
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
