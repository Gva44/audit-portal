"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock, ShieldCheck, User } from "lucide-react";

const GOOGLE_ERRORS: Record<string, string> = {
  not_registered: "That Google account has not been added yet. Ask your administrator to add you.",
  google_wrong_domain: "Please sign in with your company Google account.",
  google_failed: "Google sign-in did not complete. Please try again.",
  google_not_configured: "Google sign-in is not set up yet.",
};

export default function LoginForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [error, setError] = useState<string | null>(urlError ? (GOOGLE_ERRORS[urlError] ?? null) : null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("Incorrect username or password");
      return;
    }
    const next = searchParams.get("next") || "/library";
    router.push(next);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-modal"
    >
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <ShieldCheck size={20} strokeWidth={2.25} />
      </span>
      <h1 className="mb-1 text-lg font-semibold tracking-tight text-foreground">Audit Portal</h1>
      <p className="mb-6 text-sm text-muted">
        {googleEnabled ? "Sign in with your company account." : "Sign in with your email to continue."}
      </p>
      {googleEnabled && (
        <>
          <a
            href={`/api/auth/google/start?next=${encodeURIComponent(searchParams.get("next") || "/library")}`}
            className="mb-4 flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
              <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Sign in with Google
          </a>
          <div className="mb-4 flex items-center gap-3 text-xs text-muted-2">
            <span className="h-px flex-1 bg-border" />
            or use a password
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <div className="relative mb-3">
        <User
          size={15}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-2"
        />
        <input
          type="text"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Email"
          className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
        />
      </div>
      <div className="relative mb-3">
        <Lock
          size={15}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-2"
        />
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-2 transition-colors hover:text-muted"
        >
          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={loading || !username || !password}
        className="w-full rounded-lg bg-accent px-3.5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
