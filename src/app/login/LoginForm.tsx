"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("Incorrect password");
      return;
    }
    const next = searchParams.get("next") || "/library";
    router.push(next);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-[0_1px_2px_rgba(35,32,27,0.04),0_12px_32px_-16px_rgba(35,32,27,0.12)]"
    >
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <ShieldCheck size={20} strokeWidth={2.25} />
      </span>
      <h1 className="mb-1 text-lg font-semibold tracking-tight text-foreground">Audit Portal</h1>
      <p className="mb-6 text-sm text-muted">Enter the access password to continue.</p>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="mb-3 w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
      />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full rounded-lg bg-accent px-3.5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
