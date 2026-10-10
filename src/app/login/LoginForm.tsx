"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const GOOGLE_ERRORS: Record<string, string> = {
  not_registered: "That Google account has not been added yet. Ask your administrator to add you.",
  google_wrong_domain: "Please sign in with your company Google account.",
  google_failed: "Google sign-in did not complete. Please try again.",
  google_not_configured: "Google sign-in is not set up yet.",
};

const inputClass =
  "w-full rounded-[10px] border border-border bg-surface px-3.5 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent";

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
      setError("Incorrect email or password");
      return;
    }
    const next = searchParams.get("next") || "/library";
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-[380px] flex-col gap-5">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight text-foreground">Welcome back</h1>
        <p className="mt-2 leading-relaxed text-muted">
          Sign in to answer questionnaires and manage your client documents.
        </p>
      </div>

      {googleEnabled && (
        <>
          <a
            href={`/api/auth/google/start?next=${encodeURIComponent(searchParams.get("next") || "/library")}`}
            className="flex items-center justify-center gap-2.5 rounded-[10px] border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
          >
            <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
              <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Continue with Google
          </a>
          <div className="flex items-center gap-3.5 text-xs text-muted-2">
            <span className="h-px flex-1 bg-border" />
            or use a password
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <div className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-[13px] font-semibold text-foreground">
            Email
          </label>
          <input
            id="login-email"
            type="text"
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="name@newvest.my"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1.5 block text-[13px] font-semibold text-foreground">
            Password
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-1.5 top-1/2 flex h-[34px] w-[34px] -translate-y-1/2 items-center justify-center rounded-lg text-muted-2 transition-colors hover:text-muted"
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={loading || !username || !password}
        className="flex items-center justify-center gap-2 rounded-[10px] bg-foreground px-4 py-3 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading && <Loader2 size={15} className="animate-spin" />}
        {loading ? "Signing in..." : "Sign in"}
      </button>

      <p className="text-center text-[13px] leading-relaxed text-muted">
        No account yet? Ask your administrator to add your work email.
      </p>
    </form>
  );
}
