// Creates (or resets the password for) a portal login.
// Usage: npm run user:add -- <username> "<Display Name>" [password]
// If no password is given, a random one is generated and printed once — share it with
// that person yourself; it is not stored anywhere in plaintext.
import crypto from "node:crypto";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: ".env.local" });

const [, , usernameArg, displayNameArg, passwordArg] = process.argv;

if (!usernameArg || !displayNameArg) {
  console.error('Usage: npm run user:add -- <username> "<Display Name>" [password]');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.local first.");
  process.exit(1);
}

const username = usernameArg.trim().toLowerCase();
const displayName = displayNameArg.trim();

// Must match src/lib/auth.ts's PBKDF2 parameters exactly (iterations, hash, key length)
// so either side can verify a hash the other one created.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH_BYTES = 32;

function generatePassword() {
  return crypto.randomBytes(9).toString("base64url"); // 12 chars, URL-safe
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH_BYTES, "sha256");
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const password = passwordArg || generatePassword();
const passwordHash = hashPassword(password);

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query(
    `insert into users (username, display_name, password_hash)
     values ($1, $2, $3)
     on conflict (username) do update set display_name = excluded.display_name, password_hash = excluded.password_hash`,
    [username, displayName, passwordHash]
  );
  console.log(`User "${username}" (${displayName}) is ready.`);
  if (!passwordArg) {
    console.log(`Generated password: ${password}`);
    console.log("Share this with them directly — it is not stored anywhere in plaintext.");
  }
} catch (err) {
  console.error("Failed to create user:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
