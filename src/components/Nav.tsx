"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      pathname === href ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
    }`;

  return (
    <nav className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div className="flex items-center gap-6">
        <span className="text-sm font-semibold text-neutral-900">Audit Portal</span>
        <div className="flex gap-1">
          <Link href="/library" className={linkClass("/library")}>
            Library
          </Link>
          <Link href="/upload" className={linkClass("/upload")}>
            Upload
          </Link>
        </div>
      </div>
      <button onClick={handleLogout} className="text-sm text-neutral-500 hover:text-neutral-900">
        Log out
      </button>
    </nav>
  );
}
