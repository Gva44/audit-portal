import type { NextRequest } from "next/server";
import { sql } from "./db";
import { AUTH_COOKIE, verifySessionToken } from "./auth";

export type SessionUser = {
  username: string;
  displayName: string;
  role: "admin" | "user";
  // Per-user AI permissions set by an administrator; admins always have both.
  canGenerate: boolean;
  canAssist: boolean;
};

// For API routes: resolves the signed-in user from the session cookie (a database lookup,
// unlike proxy.ts which only verifies the signature). Null if signed out or the account
// has since been removed.
export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const username = await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value);
  if (!username) return null;
  const rows = await sql`
    select username, display_name, role, can_generate, can_assist from users where username = ${username}
  `;
  const row = rows[0];
  if (!row) return null;
  const isAdmin = row.role === "admin";
  return {
    username: row.username as string,
    displayName: row.display_name as string,
    role: isAdmin ? "admin" : "user",
    canGenerate: isAdmin || row.can_generate === true,
    canAssist: isAdmin || row.can_assist === true,
  };
}
