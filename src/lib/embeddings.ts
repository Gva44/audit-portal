import { getOpenAI } from "./openai";

// text-embedding-3-small has an 8191-token context window; this char cap keeps
// us comfortably under that without needing a tokenizer for this phase.
const MAX_EMBEDDING_INPUT_CHARS = 20000;

export async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.slice(0, MAX_EMBEDDING_INPUT_CHARS).trim() || "(empty document)";
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input,
  });
  return response.data[0].embedding;
}

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
