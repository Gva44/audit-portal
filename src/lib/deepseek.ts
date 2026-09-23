import OpenAI from "openai";

// DeepSeek's API is OpenAI SDK compatible (https://api-docs.deepseek.com).
// Lazily initialized so importing this module doesn't throw at build time
// (Next.js evaluates route modules during build, before real env vars exist).
let _client: OpenAI | null = null;

export function getDeepSeek(): OpenAI {
  if (!_client) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY environment variable is not set");
    }
    _client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com",
    });
  }
  return _client;
}

// Verify this is still current at https://api-docs.deepseek.com/quick_start/pricing
// before going live. deepseek-flash is the cheap/fast tier; deepseek-v4-pro is
// available if answer quality on complex questionnaires needs it.
export const DEEPSEEK_MODEL = "deepseek-flash";
