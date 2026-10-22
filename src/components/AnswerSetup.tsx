"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Lightbulb } from "lucide-react";
import { asAllowed, suggestColumns, type AllowedAnswers } from "@/lib/answer-format";

export type SetupColumns = {
  questionCol?: number | null;
  responseCol?: number | null;
  commentsCol?: number | null;
  citationsCol?: number | null;
  includeEvidence?: boolean;
};

export type SetupSaved = {
  column_config: SetupColumns;
  allowed_answers: AllowedAnswers;
  columns_confirmed: boolean;
};

const selectClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

const NEW_COLUMN = "new";
const SKIP = "skip";

const GUIDE = [
  "Questions are in column C, answer Yes/No in column D, remark in column E, evidence in column F.",
  "There is no Yes/No column, so put the answer and remark together in column E.",
  "Ignore the first two rows and use the sheet called Section 2.",
];

// The card that makes sure we write answers where the client wants them, before any answer is
// generated. The team confirms the layout once; it stays on the questionnaire.
export default function AnswerSetup({
  documentId,
  headers,
  config,
  allowedAnswers,
  confirmed,
  onSaved,
  onOpenColumnSetup,
}: {
  documentId: string;
  headers: string[];
  config: SetupColumns | null;
  allowedAnswers: string | null;
  confirmed: boolean;
  onSaved: (saved: SetupSaved) => void;
  onOpenColumnSetup: () => void;
}) {
  const cfg = config ?? {};
  const guess = suggestColumns(headers, cfg.questionCol ?? null);
  const initial = (saved: number | null | undefined, suggested: number | null) =>
    saved != null ? String(saved) : suggested != null ? String(suggested) : NEW_COLUMN;

  const noResponseSaved = asAllowed(allowedAnswers) === "none";
  const [response, setResponse] = useState(noResponseSaved ? SKIP : initial(cfg.responseCol, guess.responseCol));
  const [remark, setRemark] = useState(initial(cfg.commentsCol, guess.commentsCol));
  const [evidence, setEvidence] = useState(
    cfg.includeEvidence === false ? SKIP : initial(cfg.citationsCol, null)
  );
  const [accepts, setAccepts] = useState<string>(
    asAllowed(allowedAnswers) === "yesno" || asAllowed(allowedAnswers) === "yesnopartialna"
      ? (allowedAnswers as string)
      : "auto"
  );
  const [open, setOpen] = useState(!confirmed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colIdx = (v: string) => (v === NEW_COLUMN || v === SKIP ? null : Number(v));

  async function save() {
    setSaving(true);
    setError(null);
    const allowed: AllowedAnswers = response === SKIP ? "none" : (asAllowed(accepts) ?? "auto");
    const columns = {
      responseCol: colIdx(response),
      commentsCol: colIdx(remark),
      citationsCol: colIdx(evidence),
      includeEvidence: evidence !== SKIP,
    };
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns, allowedAnswers: allowed, columnsConfirmed: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save");
      onSaved({
        column_config: { ...cfg, ...columns },
        allowed_answers: allowed,
        columns_confirmed: true,
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const options = (extra: { value: string; label: string }[]) => (
    <>
      {extra.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {String.fromCharCode(65 + (i % 26))} — {h}
        </option>
      ))}
    </>
  );

  const nameOf = (v: string, fallback: string) =>
    v === NEW_COLUMN ? fallback : v === SKIP ? "not used" : (headers[Number(v)] ?? fallback);

  return (
    <div
      className={`rounded-[14px] border bg-surface ${confirmed ? "border-border" : "border-warning-border"}`}
    >
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {confirmed ? (
            <CheckCircle2 size={15} className="text-success" />
          ) : (
            <AlertTriangle size={15} className="text-warning" />
          )}
          Where our answers go in the client&apos;s file
          <span className="text-xs font-normal text-muted">
            {confirmed
              ? `Response: ${nameOf(response, "new column")} · Remark: ${nameOf(remark, "new column")} · Evidence: ${nameOf(evidence, "new column")}`
              : "Please check this before generating answers"}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-muted-2 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4">
          {!confirmed && (
            <p className="mb-3 text-sm text-muted">
              Clients lay out their files differently, so the portal needs to know which column takes the answer.
              We have pre-filled our best guess from the headings. Change anything that is wrong, then confirm.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Yes / No answer goes into</label>
              <select value={response} onChange={(e) => setResponse(e.target.value)} className={selectClass}>
                {options([
                  { value: NEW_COLUMN, label: "Add a new column" },
                  { value: SKIP, label: "No such column: start the remark with Yes or No" },
                ])}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Remark goes into</label>
              <select value={remark} onChange={(e) => setRemark(e.target.value)} className={selectClass}>
                {options([{ value: NEW_COLUMN, label: "Add a new column" }])}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Evidence (document names) goes into</label>
              <select value={evidence} onChange={(e) => setEvidence(e.target.value)} className={selectClass}>
                {options([
                  { value: NEW_COLUMN, label: "Add a new column" },
                  { value: SKIP, label: "Leave evidence out (remark only)" },
                ])}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">The client&apos;s answer column accepts</label>
              <select
                value={accepts}
                onChange={(e) => setAccepts(e.target.value)}
                disabled={response === SKIP}
                className={`${selectClass} disabled:opacity-50`}
              >
                <option value="auto">Work it out from the heading</option>
                <option value="yesno">Yes or No only</option>
                <option value="yesnopartialna">Yes, No, Partial or NA</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-hover px-3.5 py-3 text-xs leading-relaxed text-muted">
            <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <p>
                The client file never says &ldquo;No&rdquo; because a control is missing. We write <b>Yes</b> and
                describe the closest related control from your documents. <b>No</b> or <b>N/A</b> is only used when a
                question truly does not apply, and those are flagged for IT to confirm. The IT review report
                spells out what was asked but not directly evidenced.
              </p>
              <p className="mt-1.5">
                Layout not right, or the questions are in a different place? Open{" "}
                <button onClick={onOpenColumnSetup} className="font-semibold text-accent underline">
                  Column setup
                </button>{" "}
                and describe it in words, for example:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {GUIDE.map((g) => (
                  <li key={g}>&ldquo;{g}&rdquo;</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {confirmed ? "Save changes" : "Confirm and continue"}
            </button>
            {error && <span className="text-xs text-danger">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
