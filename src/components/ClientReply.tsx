"use client";

import { useState } from "react";
import { Loader2, MessageSquareReply, Pencil, Plus, Trash2 } from "lucide-react";
import { asReplyStatus, REPLY_STATUS_LABEL, type ReplyStatus } from "@/lib/reply";

export type ReplyFields = {
  id: string;
  client_reply: string | null;
  reply_status: string | null;
  reply_note: string | null;
  reply_by: string | null;
  reply_by_display_name: string | null;
  reply_at: string | null;
};

const STATUS_CLASS: Record<ReplyStatus, string> = {
  agreed: "border border-success-border bg-success-soft text-success",
  different: "border border-danger-border bg-danger-soft text-danger",
  query: "border border-accent/30 bg-accent-soft text-accent",
  unclear: "border border-neutral-border bg-surface text-muted",
};

const fieldClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

// Where the team pastes what the client wrote back about one answer. The reply is kept apart
// from our answer; the portal compares the two and sets a status, which the person can change.
export default function ClientReply({
  question,
  onUpdated,
}: {
  question: ReplyFields;
  onUpdated: (updated: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(question.client_reply ?? "");
  const [status, setStatus] = useState<string>("auto");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = asReplyStatus(question.reply_status);

  async function send(body: Record<string, unknown>, done?: () => void) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/questions/${question.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the reply");
      onUpdated(data.question);
      done?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the reply");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const body: Record<string, unknown> = { reply: text };
    if (status !== "auto") body.status = status;
    send(body, () => setEditing(false));
  }

  if (!question.client_reply && !editing) {
    return (
      <button
        onClick={() => {
          setText("");
          setStatus("auto");
          setEditing(true);
        }}
        className="flex items-center gap-1.5 self-start rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Plus size={13} />
        Add client reply
      </button>
    );
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="mb-2 flex items-center gap-2 text-[13px] font-bold text-foreground">
          <MessageSquareReply size={15} />
          Client reply
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Paste what the client wrote back about this answer"
          className={fieldClass}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground">
              <option value="auto">Let the portal work it out</option>
              <option value="agreed">Agreed</option>
              <option value="different">Different</option>
              <option value="query">Client query</option>
              <option value="unclear">Unclear</option>
            </select>
          </label>
          <button
            onClick={save}
            disabled={saving || !text.trim()}
            className="flex items-center gap-2 rounded-lg bg-foreground px-3.5 py-1.5 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            Save reply
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="rounded-lg border border-border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-[13px] font-bold text-foreground">
          <MessageSquareReply size={15} />
          Client reply
        </p>
        {current && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[current]}`}>
            {REPLY_STATUS_LABEL[current]}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          Change status
          <select
            value={current ?? "unclear"}
            disabled={saving}
            onChange={(e) => send({ status: e.target.value })}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value="agreed">Agreed</option>
            <option value="different">Different</option>
            <option value="query">Client query</option>
            <option value="unclear">Unclear</option>
          </select>
        </label>
      </div>
      <p className="whitespace-pre-line rounded-xl bg-surface-hover px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
        {question.client_reply}
      </p>
      {question.reply_note && (
        <p className="mt-2 text-[13px] leading-relaxed text-foreground">
          <span className="font-semibold text-muted">What the client wants:</span> {question.reply_note}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setText(question.client_reply ?? "");
            setStatus("auto");
            setEditing(true);
          }}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
        >
          <Pencil size={11} />
          Edit reply
        </button>
        <button
          onClick={() => {
            if (confirm("Remove this client reply?")) send({ reply: "" });
          }}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover"
        >
          <Trash2 size={11} />
          Remove
        </button>
        {question.reply_at && (
          <span className="text-xs text-muted-2">
            Added by {question.reply_by_display_name || question.reply_by || "someone"} ·{" "}
            {new Date(question.reply_at).toLocaleDateString()}
          </span>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
