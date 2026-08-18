// One-time / repeatable setup script: applies db/schema.sql to your Neon database.
// Usage: npm run db:init
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.local first (see .env.example).");
  process.exit(1);
}

const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
const schema = readFileSync(schemaPath, "utf8");

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  console.log("Connected to database. Applying db/schema.sql ...");
  await client.query(schema);
  console.log("Schema applied successfully.");
} catch (err) {
  console.error("Failed to apply schema:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
