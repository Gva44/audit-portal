import { getGemini } from "./gemini";

// Verify this is still the current model name/id at https://ai.google.dev/gemini-api/docs/models
// before going live — Google's embedding model lineup has moved fast (embedding-001 ->
// text-embedding-004 -> gemini-embedding-001 -> gemini-embedding-2-preview at various points).
const EMBEDDING_MODEL = "gemini-embedding-001";

// Requested explicitly via outputDimensionality below (Matryoshka truncation), so this
// is authoritative regardless of the model's own default — must match db/schema.sql's
// `embedding vector(768)` column exactly, or inserts will fail.
export const EMBEDDING_DIMENSIONS = 768;

const MAX_EMBEDDING_INPUT_CHARS = 20000;

// Google's free tier regularly answers 503 "high demand" or 429 "slow down" for a moment;
// both clear within seconds, so retry with a growing pause instead of failing the answer.
const RETRY_DELAYS_MS = [1000, 2500, 5000, 9000];

function isTemporary(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /\b(503|429|500)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(text);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.slice(0, MAX_EMBEDDING_INPUT_CHARS).trim() || "(empty document)";
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await getGemini().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [input],
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });
      const values = response.embeddings?.[0]?.values;
      if (!values) throw new Error("Gemini did not return an embedding");
      return values;
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTemporary(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
