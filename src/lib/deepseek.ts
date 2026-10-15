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
    // Under load DeepSeek can hold a request open for minutes before starting. Give up
    // after 50s (the answer route's limit is 60s) and let the caller report "busy";
    // retries are handled in questions.ts, so the SDK's own are off.
    _client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com",
      timeout: 50_000,
      maxRetries: 0,
    });
  }
  return _client;
}

// Verify this is still current at https://api-docs.deepseek.com/quick_start/pricing
// before going live. deepseek-flash is the cheap/fast tier; deepseek-v4-pro is
// available if answer quality on complex questionnaires needs it.
export const DEEPSEEK_MODEL = "deepseek-flash";
