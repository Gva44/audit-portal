import { getDeepSeek, DEEPSEEK_MODEL } from "./deepseek";
import { getGemini } from "./gemini";

const GEMINI_MODEL = "gemini-flash-latest";

export type Usage = {
  provider: "deepseek" | "gemini";
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type GenResult = {
  text: string;
  // "deepseek-flash", or "gemini-flash-latest (backup)" when Gemini stepped in.
  modelUsed: string;
  usage: Usage;
};

export type GenOptions = {
  system: string;
  user: string;
  // Ask for a JSON object (the prompt must also describe the JSON shape).
  json?: boolean;
  maxTokens?: number;
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function viaDeepSeek(opts: GenOptions): Promise<{ text: string; usage: Usage }> {
  // `thinking` is a DeepSeek-specific field the OpenAI SDK's types don't know about. With
  // thinking on, the model spends most of max_tokens reasoning first and a long prompt can
  // leave an empty answer; these tasks don't need it.
  const params: Parameters<ReturnType<typeof getDeepSeek>["chat"]["completions"]["create"]>[0] & {
    thinking: { type: "disabled" };
  } = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 4096,
    thinking: { type: "disabled" },
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
  };

  let raw: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await getDeepSeek().chat.completions.create(params);
      break;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const timedOut = /timed out|timeout|aborted/i.test(errorText(err));
      const busy = timedOut || status === 429 || (status !== undefined && status >= 500);
      if (busy && (timedOut || attempt >= 2)) {
        throw new Error("DeepSeek is busy right now and did not answer in time.");
      }
      if (!busy) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }

  const response = raw as {
    choices: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error(`DeepSeek returned an empty response (finish reason: ${response.choices[0]?.finish_reason ?? "unknown"})`);
  }
  return {
    text,
    usage: {
      provider: "deepseek",
      model: DEEPSEEK_MODEL,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

async function viaGemini(opts: GenOptions): Promise<{ text: string; usage: Usage }> {
  const run = () =>
    getGemini().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ text: opts.user }],
      config: {
        systemInstruction: opts.system,
        maxOutputTokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    });
  let response;
  try {
    response = await run();
  } catch (err) {
    // Google's free tier regularly answers 503 "high demand" for a moment.
    if (!/\b(503|429|500)\b|UNAVAILABLE|high demand/i.test(errorText(err))) throw err;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    response = await run();
  }
  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return {
    text,
    usage: {
      provider: "gemini",
      model: GEMINI_MODEL,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// DeepSeek is the main model. If it fails or does not answer in time (it is sometimes
// overloaded, and an unfunded balance fails the same way), Gemini answers instead so the
// team is never blocked. Which model answered is recorded in the result.
export async function generate(opts: GenOptions): Promise<GenResult> {
  try {
    const r = await viaDeepSeek(opts);
    return { text: r.text, modelUsed: DEEPSEEK_MODEL, usage: r.usage };
  } catch (deepSeekErr) {
    try {
      const r = await viaGemini(opts);
      return { text: r.text, modelUsed: `${GEMINI_MODEL} (backup)`, usage: r.usage };
    } catch (geminiErr) {
      throw new Error(
        `DeepSeek failed (${errorText(deepSeekErr).slice(0, 120)}) and the Gemini backup also failed (${errorText(geminiErr).slice(0, 120)}). Please try again in a minute.`
      );
    }
  }
}
