"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import { Building2, KeyRound, Loader2, Trash2, UserPlus } from "lucide-react";

type UserRow = {
  username: string;
  display_name: string;
  role: "admin" | "user";
  has_password: boolean;
};
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

  const load = useCallback(async () => {
    const [usersRes, clientsRes] = await Promise.all([fetch("/api/users"), fetch("/api/clients")]);
    if (usersRes.status === 403) {
      setForbidden(true);
      return;
    }
    setUsers((await usersRes.json()).users ?? []);
    const c = await clientsRes.json();
    setClients(c.clients ?? []);
    setGeneralCount(c.generalCount ?? 0);
  }, []);

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
          <p className="mt-1.5 text-muted">Manage clients and who can sign in.</p>
        </header>

        {forbidden && (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
            Only an administrator can open this page.
          </p>
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
                  <li key={u.username} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
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
