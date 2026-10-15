"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import { Building2, KeyRound, Loader2, Sparkles, Trash2, UserPlus, Wallet } from "lucide-react";

type UserRow = {
  username: string;
  display_name: string;
  role: "admin" | "user";
  can_generate: boolean;
  can_assist: boolean;
  has_password: boolean;
};

type AiOverview = {
  settings: { generateEnabled: boolean; assistEnabled: boolean; monthlyCapUsd: number | null };
  balance: { currency: string; total: string; available: boolean } | null;
  balanceError: string | null;
  month: { calls: number; inputTokens: number; outputTokens: number; cost: number };
  byFeature: { label: string; calls: number; cost: number; backup_calls: number }[];
  byUser: { name: string; calls: number; cost: number }[];
};

function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        on ? "bg-accent" : "bg-border-strong"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

function money(n: number): string {
  return n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`;
}
type ClientRow = { id: string; name: string; document_count: number };

export default function AdminPage() {
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [generalCount, setGeneralCount] = useState(0);

  const [clientName, setClientName] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [password, setPassword] = useState("");
  const [userError, setUserError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ai, setAi] = useState<AiOverview | null>(null);
  const [capInput, setCapInput] = useState("");

  const load = useCallback(async () => {
    const [usersRes, clientsRes, aiRes] = await Promise.all([
      fetch("/api/users"),
      fetch("/api/clients"),
      fetch("/api/ai/overview"),
    ]);
    if (usersRes.status === 403) {
      setForbidden(true);
      return;
    }
    setUsers((await usersRes.json()).users ?? []);
    const c = await clientsRes.json();
    setClients(c.clients ?? []);
    setGeneralCount(c.generalCount ?? 0);
    if (aiRes.ok) {
      const overview: AiOverview = await aiRes.json();
      setAi(overview);
      setCapInput(overview.settings.monthlyCapUsd ? String(overview.settings.monthlyCapUsd) : "");
    }
  }, []);

  async function saveAiSettings(patch: Record<string, unknown>) {
    await fetch("/api/ai/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    load();
  }

  async function setUserFlag(username: string, patch: { canGenerate?: boolean; canAssist?: boolean }) {
    setUsers((prev) =>
      prev.map((u) =>
        u.username === username
          ? {
              ...u,
              can_generate: patch.canGenerate ?? u.can_generate,
              can_assist: patch.canAssist ?? u.can_assist,
            }
          : u
      )
    );
    await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function addClient(e: FormEvent) {
    e.preventDefault();
    setClientError(null);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: clientName }),
    });
    const data = await res.json();
    if (!res.ok) {
      setClientError(data.error || "Could not add client");
      return;
    }
    setClientName("");
    load();
  }

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setUserError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: email,
          displayName: name,
          role,
          password,
          generatePassword: !password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUserError(data.error || "Could not add user");
        return;
      }
      setNotice(
        data.generatedPassword
          ? `Created ${email}. Temporary password (shown once, copy it now): ${data.generatedPassword}`
          : `Created ${email}.`
      );
      setEmail("");
      setName("");
      setPassword("");
      setRole("user");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(username: string) {
    const next = prompt(`New password for ${username} (leave blank to cancel):`);
    if (!next) return;
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: next }),
    });
    setNotice(res.ok ? `Password updated for ${username}.` : "Could not update the password.");
  }

  async function removeUser(username: string) {
    if (!confirm(`Remove ${username}? They will no longer be able to sign in.`)) return;
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) setNotice(data.error || "Could not remove the user.");
    load();
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent";

  return (
    <div className="min-h-screen bg-background md:pl-[232px]">
      <Nav />
      <main className="flex flex-col gap-7 px-6 py-10 md:px-12">
        <header>
          <h1 className="text-[28px] font-bold tracking-tight text-foreground">Admin</h1>
          <p className="mt-1.5 text-muted">Manage clients, who can sign in, and the AI features.</p>
        </header>

        {forbidden && (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
            Only an administrator can open this page.
          </p>
        )}

        {!forbidden && ai && (
          <section className="rounded-[14px] border border-border bg-surface p-6">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles size={15} /> AI features and usage
            </h2>
            <p className="mb-5 text-xs text-muted">
              Switch AI features on or off for everyone, set a monthly spending limit, and see what has been used this
              month. Figures are estimates from the portal&apos;s own records; the balance is read live from DeepSeek.
            </p>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">
                  <Wallet size={12} /> DeepSeek balance
                </p>
                {ai.balance ? (
                  <>
                    <p className="mt-2 text-[26px] font-bold tracking-tight text-foreground">
                      ${Number(ai.balance.total).toFixed(2)}
                    </p>
                    <p className={`text-xs ${ai.balance.available ? "text-success" : "text-danger"}`}>
                      {ai.balance.available ? "Available" : "Out of balance, top up on DeepSeek"}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-danger">{ai.balanceError ?? "Unavailable"}</p>
                )}
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">Spent this month</p>
                <p className="mt-2 text-[26px] font-bold tracking-tight text-foreground">{money(ai.month.cost)}</p>
                <p className="text-xs text-muted">{ai.month.calls} AI calls</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">Words processed</p>
                <p className="mt-2 text-[26px] font-bold tracking-tight text-foreground">
                  {((ai.month.inputTokens + ai.month.outputTokens) / 1000).toFixed(0)}k
                </p>
                <p className="text-xs text-muted">tokens in and out</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">Monthly limit</p>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveAiSettings({ monthlyCapUsd: capInput.trim() ? Number(capInput) : null });
                  }}
                >
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-2">$</span>
                    <input
                      value={capInput}
                      onChange={(e) => setCapInput(e.target.value)}
                      inputMode="decimal"
                      placeholder="No limit"
                      className={`${inputClass} pl-7`}
                    />
                  </div>
                  <button
                    type="submit"
                    className="shrink-0 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
                  >
                    Save
                  </button>
                </form>
                <p className="mt-1.5 text-xs text-muted">AI pauses for the month when reached.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-semibold text-foreground">Answer generation</span>
                    <span className="block text-xs text-muted">Master switch for everyone, including administrators.</span>
                  </span>
                  <Toggle
                    on={ai.settings.generateEnabled}
                    onChange={(v) => saveAiSettings({ generateEnabled: v })}
                    label="Answer generation for everyone"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-semibold text-foreground">AI assistant</span>
                    <span className="block text-xs text-muted">Explain, draft policies, raise scores, gap reports.</span>
                  </span>
                  <Toggle
                    on={ai.settings.assistEnabled}
                    onChange={(v) => saveAiSettings({ assistEnabled: v })}
                    label="AI assistant for everyone"
                  />
                </label>
                <p className="text-xs text-muted">
                  Individual access is set per person in the Users list below. Administrators always have access while a
                  master switch is on.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">By feature</p>
                  {ai.byFeature.length === 0 && <p className="text-sm text-muted">No usage yet this month.</p>}
                  <ul className="space-y-1.5 text-sm">
                    {ai.byFeature.map((f) => (
                      <li key={f.label} className="flex items-center justify-between gap-2">
                        <span className="text-foreground">
                          {f.label}
                          {f.backup_calls > 0 && (
                            <span className="ml-1.5 text-xs text-muted-2">({f.backup_calls} via Gemini backup)</span>
                          )}
                        </span>
                        <span className="font-mono text-xs text-muted">
                          {f.calls} · {money(f.cost)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">By person</p>
                  {ai.byUser.length === 0 && <p className="text-sm text-muted">No usage yet this month.</p>}
                  <ul className="space-y-1.5 text-sm">
                    {ai.byUser.map((u) => (
                      <li key={u.name} className="flex items-center justify-between gap-2">
                        <span className="text-foreground">{u.name}</span>
                        <span className="font-mono text-xs text-muted">
                          {u.calls} · {money(u.cost)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        )}

        {!forbidden && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <section className="rounded-[14px] border border-border bg-surface p-6">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Building2 size={15} /> Clients
              </h2>
              <p className="mb-4 text-xs text-muted">
                Each client gets its own folder in Google Drive on first upload. Documents with no client sit in
                General and are available to every client&apos;s questionnaires.
              </p>
              <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
                <li className="flex items-center justify-between px-3.5 py-2.5 text-sm">
                  <span className="font-medium text-foreground">General</span>
                  <span className="text-xs text-muted">{generalCount} {generalCount === 1 ? "document" : "documents"}</span>
                </li>
                {clients.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-xs text-muted">{c.document_count} {c.document_count === 1 ? "document" : "documents"}</span>
                  </li>
                ))}
              </ul>
              <form onSubmit={addClient} className="flex gap-2">
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="New client name, e.g. HSBC"
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={!clientName.trim()}
                  className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add client
                </button>
              </form>
              {clientError && <p className="mt-2 text-sm text-danger">{clientError}</p>}
            </section>

            <section className="rounded-[14px] border border-border bg-surface p-6">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                <UserPlus size={15} /> Users
              </h2>
              <p className="mb-4 text-xs text-muted">
                Use each person&apos;s work email as the username. Leave the password blank to generate one for them.
                Everyone can see every client; the login only records who ran each AI answer.
              </p>
              <ul className="mb-5 divide-y divide-border rounded-lg border border-border">
                {users.map((u) => (
                  <li key={u.username} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{u.display_name}</p>
                      <p className="truncate text-xs text-muted">{u.username}</p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        u.role === "admin"
                          ? "border-warning-border bg-warning-soft text-warning"
                          : "border-neutral-border bg-surface-hover text-muted"
                      }`}
                    >
                      {u.role}
                    </span>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <label className="flex items-center gap-1.5" title="May generate answers">
                        Answers
                        <Toggle
                          on={u.role === "admin" || u.can_generate}
                          disabled={u.role === "admin"}
                          onChange={(v) => setUserFlag(u.username, { canGenerate: v })}
                          label={`Allow ${u.display_name} to generate answers`}
                        />
                      </label>
                      <label className="flex items-center gap-1.5" title="May use the AI assistant">
                        Assistant
                        <Toggle
                          on={u.role === "admin" || u.can_assist}
                          disabled={u.role === "admin"}
                          onChange={(v) => setUserFlag(u.username, { canAssist: v })}
                          label={`Allow ${u.display_name} to use the AI assistant`}
                        />
                      </label>
                    </div>
                    <button
                      onClick={() => resetPassword(u.username)}
                      title="Set a new password"
                      className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                    >
                      <KeyRound size={15} />
                    </button>
                    <button
                      onClick={() => removeUser(u.username)}
                      title="Remove user"
                      className="rounded-lg p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>

              <form onSubmit={addUser} className="grid gap-2 sm:grid-cols-2">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Work email"
                  type="email"
                  className={inputClass}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className={inputClass}
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (blank = generate one)"
                  className={inputClass}
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "user" | "admin")}
                  className={inputClass}
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
                <button
                  type="submit"
                  disabled={saving || !email.trim() || !name.trim()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
                >
                  {saving && <Loader2 size={15} className="animate-spin" />}
                  Add user
                </button>
              </form>
              {userError && <p className="mt-2 text-sm text-danger">{userError}</p>}
              {notice && (
                <p className="mt-3 rounded-lg border border-success-border bg-success-soft px-3.5 py-2.5 text-sm text-success">
                  {notice}
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
