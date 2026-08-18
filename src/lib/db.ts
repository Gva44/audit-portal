import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Lazily initialized so importing this module doesn't throw at build time
// (Next.js evaluates route modules during build to collect page/route config,
// before any real environment variables are available).
let _sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

// Proxy forwards tagged-template calls (sql`...`) to the lazily created client.
export const sql = new Proxy((() => {}) as unknown as NeonQueryFunction<false, false>, {
  apply(_target, _thisArg, args: Parameters<NeonQueryFunction<false, false>>) {
    return Reflect.apply(getSql(), _thisArg, args);
  },
});

export type Category = "policy" | "evidence" | "questionnaire";

export type DocumentRow = {
  id: string;
  filename: string;
  category: Category;
  notes: string | null;
  mime_type: string;
  file_size: number;
  extraction_status: "pending" | "ok" | "failed";
  extraction_error: string | null;
  created_at: string;
};
