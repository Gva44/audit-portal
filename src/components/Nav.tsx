"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, LogOut, ShieldCheck, Upload } from "lucide-react";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
      pathname === href
        ? "bg-accent text-accent-foreground"
        : "text-muted hover:bg-surface-hover hover:text-foreground"
    }`;

  return (
    <nav className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <ShieldCheck size={16} strokeWidth={2.25} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Audit Portal
            </span>
          </div>
          <div className="flex gap-1">
            <Link href="/library" className={linkClass("/library")}>
              <LayoutGrid size={15} />
              Library
            </Link>
            <Link href="/upload" className={linkClass("/upload")}>
              <Upload size={15} />
              Upload
            </Link>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline">Log out</span>
        </button>
      </div>
    </nav>
  );
}
