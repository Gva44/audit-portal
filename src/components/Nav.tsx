"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, LogOut, Settings, ShieldCheck, Upload } from "lucide-react";

type ClientRow = { id: string; name: string; document_count: number };

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-surface">
        <ShieldCheck size={15} strokeWidth={2.25} />
      </span>
      <span className="text-[15px] font-bold tracking-tight text-foreground">Audit Portal</span>
    </div>
  );
}

function NavInner() {
  const pathname = usePathname();
  const router = useRouter();
  const activeClient = useSearchParams().get("client") ?? "all";
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [generalCount, setGeneralCount] = useState(0);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setDisplayName(data?.user?.displayName ?? null);
        setIsAdmin(data?.user?.role === "admin");
      })
      .catch(() => setDisplayName(null));
    fetch("/api/clients")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setClients(data?.clients ?? []);
        setGeneralCount(data?.generalCount ?? 0);
      })
      .catch(() => setClients([]));
  }, []);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
      pathname === href
        ? "bg-surface-hover font-semibold text-foreground"
        : "font-medium text-muted hover:bg-surface-hover hover:text-foreground"
    }`;

  const onLibrary = pathname === "/library";
  const clientClass = (value: string) =>
    `flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
      onLibrary && activeClient === value
        ? "bg-surface-hover text-foreground"
        : "text-muted hover:bg-surface-hover hover:text-foreground"
    }`;

  const total = clients.reduce((sum, c) => sum + c.document_count, generalCount);
  const initial = (displayName ?? "?").charAt(0).toUpperCase();

  const links = (
    <>
      <Link href="/library" className={linkClass("/library")}>
        <LayoutGrid size={16} />
        Library
      </Link>
      <Link href="/upload" className={linkClass("/upload")}>
        <Upload size={16} />
        Upload
      </Link>
      {isAdmin && (
        <Link href="/admin" className={linkClass("/admin")}>
          <Settings size={16} />
          Admin
        </Link>
      )}
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col gap-7 border-r border-border bg-surface px-4 py-6 md:flex">
        <Logo />
        <nav className="flex flex-col gap-0.5">{links}</nav>

        <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          <p className="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-2">Clients</p>
          <Link href="/library" className={clientClass("all")}>
            <span>All clients</span>
            <span className="font-mono text-xs text-muted-2">{total}</span>
          </Link>
          <Link href="/library?client=general" className={clientClass("general")}>
            <span>General</span>
            <span className="font-mono text-xs text-muted-2">{generalCount}</span>
          </Link>
          {clients.map((c) => (
            <Link key={c.id} href={`/library?client=${c.id}`} className={clientClass(c.id)}>
              <span className="truncate">{c.name}</span>
              <span className="font-mono text-xs text-muted-2">{c.document_count}</span>
            </Link>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-2.5 rounded-xl bg-surface-hover p-2.5">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
            {initial}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-foreground">{displayName ?? ""}</p>
            <p className="text-xs text-muted">{isAdmin ? "Administrator" : "User"}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur-sm md:hidden">
        <Logo />
        <nav className="flex items-center gap-1">{links}</nav>
        <button
          onClick={handleLogout}
          title="Log out"
          className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <LogOut size={16} />
        </button>
      </header>
    </>
  );
}

export default function Nav() {
  return (
    <Suspense fallback={null}>
      <NavInner />
    </Suspense>
  );
}
