// Uses Web Crypto (available in both the Node.js and Edge runtimes) so this
// module works from Next.js middleware without pinning it to the Node runtime.

const encoder = new TextEncoder();

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes.buffer;
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

// Session token is "<username>.<hmac(username)>" — self-contained and verifiable without
// a database round trip (needed since proxy.ts runs on every request in the Edge runtime).
export async function createSessionToken(username: string): Promise<string> {
  return `${username}.${await hmac(username)}`;
}

// Returns the signed-in username, or null if the token is missing/invalid.
export async function verifySessionToken(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const username = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = await hmac(username);
  return timingSafeEqualStr(signature, expected) ? username : null;
}

// PBKDF2-SHA256, matching scripts/add-user.mjs's Node `crypto.pbkdf2Sync` call exactly
// (same iteration count, hash, and derived key length) so hashes made by either are
// interchangeable. Stored as "<salt-hex>:<hash-hex>".
export const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH_BITS = 256;

async function derivePbkdf2Hex(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBuf(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BITS
  );
  return bufToHex(bits);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;
  const computed = await derivePbkdf2Hex(password, saltHex);
  return timingSafeEqualStr(computed, hashHex);
}
