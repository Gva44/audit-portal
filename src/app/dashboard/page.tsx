"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ChevronDown,
  CircleDashed,
  FileWarning,
  History,
  Layers,
  Sparkles,
  TrendingDown,
  Wallet,
  XCircle,
} from "lucide-react";

type Card = {
  id: string;
  name: string;
  shared: boolean;
  questionnaires: number;
  total: number;
  answered: number;
  ready: number;
  updateNeeded: number;
  recheck: number;
  policies: number;
  evidence: number;
  lastActivity: string | null;
  latestQuestionnaireId: string | null;
};

type ContinueItem = {
  id: string;
  filename: string;
  clientName: string;
  total: number;
  answered: number;
  ready: number;
  updateNeeded: number;
  recheck: number;
  lastActivity: string;
};

type Attention = { kind: string; text: string; href: string; questionnaire?: string };
type Activity = { at: string; text: string; href: string };

type Data = {
  clients: { id: string; name: string }[];
  cards: Card[];
  continueList: ContinueItem[];
  attention: Attention[];
  activity: Activity[];
};

type AiStrip = { balance: { total: string; available: boolean } | null; month: { cost: number; calls: number } };

const STORAGE_KEY = "portal.dashboard.client";

function timeAgo(iso: string | null): string {
  if (!iso) return "no activity yet";
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function ReadinessBar({ ready, update, recheck }: { ready: number; update: number; recheck: number }) {
  const sum = ready + update + recheck;
  if (sum === 0) return <div className="h-1.5 rounded-full bg-border" />;
  return (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-border">
      <div className="bg-[#2f9e6b]" style={{ flex: ready }} />
      <div className="bg-[#e0a02b]" style={{ flex: update }} />
      <div className="bg-[#d9534f]" style={{ flex: recheck }} />
    </div>
  );
}

const ATTENTION_ICON: Record<string, typeof AlertTriangle> = {
  failed: XCircle,
  empty: CircleDashed,
  pending: CircleDashed,
  low: TrendingDown,
  extraction: FileWarning,
};

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = searchParams.get("client") ?? "all";
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState<AiStrip | null>(null);

  // Return to the client the person last looked at when they open the page fresh.
  useEffect(() => {
    if (searchParams.get("client")) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && saved !== "all") router.replace(`/dashboard?client=${saved}`);
    } catch {
      // storage unavailable: stay on "all"
    }
  }, [router, searchParams]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/dashboard?client=${encodeURIComponent(scope)}`)
        .then((r) => r.json())
        .then((d: Data) => {
          if (!cancelled) setData(d);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [scope]);

  useEffect(() => {
    fetch("/api/ai/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAi({ balance: d.balance, month: d.month }))
      .catch(() => undefined);
  }, []);

  function choose(value: string) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore
    }
    router.replace(value === "all" ? "/dashboard" : `/dashboard?client=${value}`);
  }

  const scopeName =
    scope === "all"
      ? "All clients"
      : scope === "general"
        ? "General"
        : (data?.clients.find((c) => c.id === scope)?.name ?? "All clients");

  return (
    <div className="min-h-screen bg-background md:pl-[232px]">
      <Nav />
      <main className="flex flex-col gap-7 px-6 py-10 md:px-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-foreground">Dashboard</h1>
            <p className="mt-1.5 text-muted">Where each client stands, and where to pick up.</p>
          </div>
          <div className="flex items-center gap-2.5">
            <label htmlFor="dashboard-client" className="text-sm font-medium text-muted">
              Client
            </label>
            <div className="relative">
              <select
                id="dashboard-client"
                value={scope}
                onChange={(e) => choose(e.target.value)}
                className="min-w-[220px] appearance-none rounded-[10px] border border-border bg-surface py-2.5 pl-3.5 pr-10 text-sm font-semibold text-foreground outline-none transition-colors focus:border-accent"
              >
                <option value="all">All clients</option>
                {(data?.clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="general">General (shared documents)</option>
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" />
            </div>
          </div>
        </header>

        {loading && !data && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-[14px] border border-border bg-surface" />
            ))}
          </div>
        )}

        {data && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.cards
                .filter((c) => scope === "all" || scope === c.id)
                .map((c) => {
                const selected = scope === c.id;
                return (
                  <div
                    key={c.id}
                    className={`flex flex-col rounded-[14px] border bg-surface p-5 transition-colors ${
                      selected ? "border-accent" : "border-border"
                    }`}
                  >
                    <button onClick={() => choose(selected ? "all" : c.id)} className="text-left">
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex items-center gap-2 text-[17px] font-bold tracking-tight text-foreground">
                          {c.shared ? <Layers size={16} className="text-muted" /> : <Building2 size={16} className="text-muted" />}
                          {c.name}
                        </p>
                        <span className="text-xs text-muted-2">{timeAgo(c.lastActivity)}</span>
                      </div>
                    </button>

                    {c.shared ? (
                      <p className="mt-3 text-sm text-muted">
                        Shared with every client: <span className="font-semibold text-foreground">{c.policies}</span>{" "}
                        policies, <span className="font-semibold text-foreground">{c.evidence}</span> evidence files.
                      </p>
                    ) : (
                      <>
                        <div className="mt-4">
                          <div className="mb-2 flex items-baseline justify-between text-sm">
                            <span className="text-muted">
                              {c.questionnaires} {c.questionnaires === 1 ? "questionnaire" : "questionnaires"}
                            </span>
                            <span className="font-mono text-xs text-muted">
                              {c.answered} / {c.total} answered
                            </span>
                          </div>
                          <ReadinessBar ready={c.ready} update={c.updateNeeded} recheck={c.recheck} />
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                            <span>
                              <span className="font-semibold text-success">{c.ready}</span> ready
                            </span>
                            <span>
                              <span className="font-semibold text-warning">{c.updateNeeded}</span> to update
                            </span>
                            <span>
                              <span className="font-semibold text-danger">{c.recheck}</span> to recheck
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-xs text-muted-2">
                          {c.policies + c.evidence} client documents ({c.policies} policies, {c.evidence} evidence)
                        </p>
                      </>
                    )}

                    {!c.shared && c.latestQuestionnaireId && (
                      <Link
                        href={`/questionnaires/${c.latestQuestionnaireId}`}
                        className="mt-4 flex items-center justify-center gap-1.5 rounded-[9px] border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
                      >
                        Open latest questionnaire
                        <ArrowRight size={14} />
                      </Link>
                    )}
                    {!c.shared && !c.latestQuestionnaireId && (
                      <Link
                        href="/upload"
                        className="mt-4 flex items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover"
                      >
                        Upload their questionnaire
                      </Link>
                    )}
                  </div>
                );
              })}
            </section>

            <p className="-mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">
              Showing: {scopeName}
            </p>

            <div className="grid items-start gap-6 xl:grid-cols-2">
              <section className="rounded-[14px] border border-border bg-surface p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <History size={15} /> Continue where you left off
                </h2>
                {data.continueList.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted">No questionnaires here yet.</p>
                )}
                <ul className="divide-y divide-border">
                  {data.continueList.map((d) => (
                    <li key={d.id} className="py-3.5 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{d.filename}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {d.clientName} · {timeAgo(d.lastActivity)}
                          </p>
                        </div>
                        <Link
                          href={`/questionnaires/${d.id}`}
                          className="flex shrink-0 items-center gap-1.5 rounded-[9px] bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
                        >
                          {d.answered >= d.total && d.total > 0 ? "Review" : "Continue"}
                          <ArrowRight size={12} strokeWidth={2.2} />
                        </Link>
                      </div>
                      <div className="mt-2.5 flex items-center gap-3">
                        <div className="flex-1">
                          <div className="h-1.5 overflow-hidden rounded-full bg-border">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${d.total ? (d.answered / d.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                        <span className="font-mono text-xs text-muted">
                          {d.answered}/{d.total}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-[14px] border border-border bg-surface p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <AlertTriangle size={15} /> Needs attention
                </h2>
                {data.attention.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted">Nothing needs attention right now.</p>
                )}
                <ul className="divide-y divide-border">
                  {data.attention.map((a, i) => {
                    const Icon = ATTENTION_ICON[a.kind] ?? AlertTriangle;
                    return (
                      <li key={i}>
                        <Link href={a.href} className="flex items-start gap-3 py-3 transition-colors first:pt-0 hover:text-accent">
                          <Icon
                            size={15}
                            className={`mt-0.5 shrink-0 ${
                              a.kind === "failed" || a.kind === "extraction"
                                ? "text-danger"
                                : a.kind === "low"
                                  ? "text-warning"
                                  : "text-muted-2"
                            }`}
                          />
                          <span className="min-w-0 text-sm">
                            <span className="block font-medium text-foreground">{a.text}</span>
                            {a.questionnaire && <span className="block truncate text-xs text-muted">{a.questionnaire}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            <section className="rounded-[14px] border border-border bg-surface p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles size={15} /> Recent activity
              </h2>
              {data.activity.length === 0 && (
                <p className="py-4 text-center text-sm text-muted">Activity will appear here as the team works.</p>
              )}
              <ul className="divide-y divide-border">
                {data.activity.map((a, i) => (
                  <li key={i}>
                    <Link
                      href={a.href}
                      className="flex items-baseline justify-between gap-4 py-2.5 text-sm transition-colors first:pt-0 last:pb-0 hover:text-accent"
                    >
                      <span className="min-w-0 truncate text-foreground">{a.text}</span>
                      <span className="shrink-0 text-xs text-muted-2">{timeAgo(a.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {ai && (
              <Link
                href="/admin"
                className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-surface px-5 py-3.5 text-sm transition-colors hover:bg-surface-hover"
              >
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  <Wallet size={15} /> AI
                </span>
                <span className="flex flex-wrap gap-x-6 gap-y-1 text-muted">
                  <span>
                    DeepSeek balance{" "}
                    <span className={`font-semibold ${ai.balance?.available === false ? "text-danger" : "text-foreground"}`}>
                      {ai.balance ? `$${Number(ai.balance.total).toFixed(2)}` : "unavailable"}
                    </span>
                  </span>
                  <span>
                    This month{" "}
                    <span className="font-semibold text-foreground">
                      {ai.month.cost < 0.01 && ai.month.cost > 0 ? "<$0.01" : `$${ai.month.cost.toFixed(2)}`}
                    </span>{" "}
                    · {ai.month.calls} calls
                  </span>
                </span>
              </Link>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardContent />
    </Suspense>
  );
}
