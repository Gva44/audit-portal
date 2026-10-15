"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Copy,
  Download,
  FileEdit,
  FilePlus2,
  HelpCircle,
  ListChecks,
  Loader2,
  Map as MapIcon,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";

type Result = { title: string; text: string; modelUsed: string; downloadable: boolean };
type Citation = { id: string; filename: string };
type PolicyOption = { id: string; filename: string };

async function callAssistant(body: Record<string, unknown>): Promise<Result> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The assistant could not complete that.");
  return data as Result;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Word opens an HTML file saved as .doc, so no extra library is needed for a downloadable draft.
function downloadWord(title: string, text: string) {
  const body = text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return "";
      if (t.startsWith("## ")) return `<h2>${escapeHtml(t.slice(3))}</h2>`;
      if (/^AI DRAFT/i.test(t)) return `<p style="color:#b45309;font-weight:bold">${escapeHtml(t)}</p>`;
      if (t.startsWith("- ")) return `<p style="margin-left:18pt">&bull; ${escapeHtml(t.slice(2))}</p>`;
      return `<p>${escapeHtml(t)}</p>`;
    })
    .join("\n");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4} h2{font-size:14pt;margin:16pt 0 6pt}</style></head><body><h1 style="font-size:18pt">${escapeHtml(title)}</h1>${body}</body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ") || "AI draft"}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function RenderedText({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-foreground">
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith("## ")) {
          return (
            <h4 key={i} className="pt-2 text-[13px] font-bold uppercase tracking-[0.04em] text-foreground">
              {t.slice(3)}
            </h4>
          );
        }
        if (/^AI DRAFT/i.test(t)) {
          return (
            <p
              key={i}
              className="flex items-center gap-1.5 rounded-lg border border-warning-border bg-warning-soft px-3 py-1.5 text-xs font-semibold text-warning"
            >
              <AlertTriangle size={13} />
              {t}
            </p>
          );
        }
        if (t.startsWith("- ")) {
          return (
            <p key={i} className="pl-4 -indent-3">
              <span className="mr-1.5 text-muted-2">•</span>
              {t.slice(2)}
            </p>
          );
        }
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
}

function ResultCard({ result, onClose }: { result: Result; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles size={14} className="text-accent" />
            {result.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-2">
            AI-generated, please check before relying on it
            {result.modelUsed.includes("backup") && " · written by the Gemini backup (DeepSeek was busy)"}
          </p>
        </div>
        <button
          onClick={onClose}
          title="Close"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <X size={15} />
        </button>
      </div>
      <RenderedText text={result.text} />
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(result.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <Copy size={12} />
          {copied ? "Copied" : "Copy"}
        </button>
        {result.downloadable && (
          <button
            onClick={() => downloadWord(result.title, result.text)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Download size={12} />
            Download for Word
          </button>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} className="text-accent" />}
      {label}
    </button>
  );
}

let policyListCache: PolicyOption[] | null = null;

// Buttons for one answer: explain it, raise its score, draft or improve a policy.
export function QuestionAssistant({ questionId, citations }: { questionId: string; citations: Citation[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [policies, setPolicies] = useState<PolicyOption[]>(policyListCache ?? []);
  const [improving, setImproving] = useState(false);
  const [policyId, setPolicyId] = useState("");
  const [ask, setAsk] = useState("");

  useEffect(() => {
    if (!improving || policyListCache) return;
    fetch("/api/documents?category=policy")
      .then((r) => r.json())
      .then((d) => {
        policyListCache = (d.documents ?? []).map((x: PolicyOption) => ({ id: x.id, filename: x.filename }));
        setPolicies(policyListCache ?? []);
      })
      .catch(() => undefined);
  }, [improving]);

  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      setResult(await callAssistant({ questionId, ...body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not complete that.");
    } finally {
      setBusy(null);
    }
  }

  const options = [
    ...citations.map((c) => ({ id: c.id, filename: `${c.filename} (used in this answer)` })),
    ...policies.filter((p) => !citations.some((c) => c.id === p.id)),
  ];

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">AI help</span>
        <ActionButton icon={HelpCircle} label="Why this answer?" busy={busy === "explain"} disabled={!!busy} onClick={() => run("explain", { action: "explain" })} />
        <ActionButton icon={TrendingUp} label="How to raise the score" busy={busy === "raise"} disabled={!!busy} onClick={() => run("raise", { action: "raise_score" })} />
        <ActionButton icon={FilePlus2} label="Draft the missing policy" busy={busy === "draft"} disabled={!!busy} onClick={() => run("draft", { action: "draft_policy" })} />
        <ActionButton icon={FileEdit} label="Improve a policy" busy={false} disabled={!!busy} onClick={() => setImproving((v) => !v)} />
      </div>

      {improving && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={policyId}
            onChange={(e) => setPolicyId(e.target.value)}
            className="min-w-[240px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="">Choose the policy to improve...</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.filename}
              </option>
            ))}
          </select>
          <button
            onClick={() => run("improve", { action: "improve_policy", policyId })}
            disabled={!policyId || !!busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "improve" && <Loader2 size={14} className="animate-spin" />}
            Suggest improvements
          </button>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.trim()) run("ask", { action: "explain", ask });
        }}
      >
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Or ask something about this answer..."
          maxLength={600}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-2 focus:border-accent"
        />
        <button
          type="submit"
          disabled={!ask.trim() || !!busy}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "ask" && <Loader2 size={14} className="animate-spin" />}
          Ask
        </button>
      </form>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {result && <ResultCard result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

// Buttons for the whole questionnaire: what to fix first, the policy roadmap, the evidence checklist.
export function DocumentAssistant({ documentId, answered }: { documentId: string; answered: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: string) {
    setBusy(key);
    setError(null);
    try {
      setResult(await callAssistant({ documentId, action }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not complete that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[14px] border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles size={14} className="text-accent" />
            AI assistant for this questionnaire
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {answered === 0
              ? "Generate some answers first, then use these to see what to improve."
              : "Looks across all the answers and your documents for this client."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={ListChecks} label="Fix these first" busy={busy === "fix"} disabled={!!busy || answered === 0} onClick={() => run("fix", "fix_first")} />
          <ActionButton icon={MapIcon} label="Policy gap report" busy={busy === "gap"} disabled={!!busy || answered === 0} onClick={() => run("gap", "gap_report")} />
          <ActionButton icon={ClipboardList} label="Evidence checklist" busy={busy === "evidence"} disabled={!!busy || answered === 0} onClick={() => run("evidence", "evidence_checklist")} />
        </div>
      </div>
      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {busy && <p className="mt-3 text-xs text-muted">Reading your answers and documents, this takes about 10–20 seconds...</p>}
      {result && (
        <div className="mt-4">
          <ResultCard result={result} onClose={() => setResult(null)} />
        </div>
      )}
    </section>
  );
}
