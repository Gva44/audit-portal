import { GoogleGenAI } from "@google/genai";

// Lazily initialized so importing this module doesn't throw at build time
// (Next.js evaluates route modules during build, before real env vars exist).
let _client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}
