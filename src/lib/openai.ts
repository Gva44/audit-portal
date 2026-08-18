import OpenAI from "openai";

// Lazily initialized so importing this module doesn't throw at build time
// (Next.js evaluates route modules during build, before real env vars exist).
let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}
