// Uses Web Crypto (available in both the Node.js and Edge runtimes) so this
// module works from Next.js middleware without pinning it to the Node runtime.

const encoder = new TextEncoder();

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(value: string): Promise<string> {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET environment variable is not set");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bufToHex(signature);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export const AUTH_COOKIE = "audit_portal_auth";
const SESSION_VALUE = "authenticated-session";

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD environment variable is not set");
  return timingSafeEqualStr(password, expected);
}

export async function createSessionToken(): Promise<string> {
  return hmac(SESSION_VALUE);
}

export async function isValidSessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await hmac(SESSION_VALUE);
  return timingSafeEqualStr(token, expected);
}
