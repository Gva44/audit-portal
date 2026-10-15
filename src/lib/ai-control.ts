import { sql } from "./db";
import type { SessionUser } from "./session";
import type { Usage } from "./ai";

export type AiFeature = "generate" | "assist";

// DeepSeek's published rates for deepseek-flash, using the higher (peak) price so the
// in-app figure never under-reports. Gemini runs on the free tier, so it costs nothing.
const DEEPSEEK_INPUT_USD_PER_MILLION = 0.3;
const DEEPSEEK_OUTPUT_USD_PER_MILLION = 1.2;

export function estimateCostUsd(usage: Usage): number {
  if (usage.provider !== "deepseek") return 0;
  return (
    (usage.inputTokens * DEEPSEEK_INPUT_USD_PER_MILLION + usage.outputTokens * DEEPSEEK_OUTPUT_USD_PER_MILLION) /
    1_000_000
  );
}

export type AiSettings = {
  // Master switches: off blocks everyone, administrators included.
  generateEnabled: boolean;
  assistEnabled: boolean;
  // Pause AI features for the rest of the month once estimated spend reaches this.
  monthlyCapUsd: number | null;
};

export async function getAiSettings(): Promise<AiSettings> {
  const rows = await sql`select key, value from settings where key in ('generate_enabled', 'assist_enabled', 'monthly_cap_usd')`;
  const map = new Map(rows.map((r) => [r.key as string, r.value as string]));
  const cap = Number(map.get("monthly_cap_usd"));
  return {
    generateEnabled: map.get("generate_enabled") !== "false",
    assistEnabled: map.get("assist_enabled") !== "false",
    monthlyCapUsd: map.has("monthly_cap_usd") && Number.isFinite(cap) && cap > 0 ? cap : null,
  };
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await sql`delete from settings where key = ${key}`;
  } else {
    await sql`insert into settings (key, value) values (${key}, ${value}) on conflict (key) do update set value = excluded.value`;
  }
}

export async function monthSpendUsd(): Promise<number> {
  const rows = await sql`
    select coalesce(sum(est_cost_usd), 0)::float as total from ai_usage
    where created_at >= date_trunc('month', now())
  `;
  return Number(rows[0].total);
}

export type AccessResult = { ok: true } | { ok: false; status: number; reason: string };

// Server-side gate for every AI call: hiding a button is not enough.
export async function checkAiAccess(user: SessionUser | null, feature: AiFeature): Promise<AccessResult> {
  if (!user) return { ok: false, status: 401, reason: "Please sign in again." };
  const settings = await getAiSettings();
  const label = feature === "generate" ? "Answer generation" : "The AI assistant";
  if (feature === "generate" ? !settings.generateEnabled : !settings.assistEnabled) {
    return { ok: false, status: 403, reason: `${label} has been switched off by an administrator.` };
  }
  if (feature === "generate" ? !user.canGenerate : !user.canAssist) {
    return { ok: false, status: 403, reason: `${label} is not enabled for your account. Ask an administrator.` };
  }
  if (settings.monthlyCapUsd !== null && (await monthSpendUsd()) >= settings.monthlyCapUsd) {
    return {
      ok: false,
      status: 403,
      reason: `The monthly AI spending limit ($${settings.monthlyCapUsd.toFixed(2)}) has been reached. An administrator can raise it on the Admin page.`,
    };
  }
  return { ok: true };
}

export async function logAiUsage(username: string | null, feature: string, usage: Usage | null): Promise<void> {
  if (!usage) return;
  await sql`
    insert into ai_usage (username, feature, provider, model, input_tokens, output_tokens, est_cost_usd)
    values (${username}, ${feature}, ${usage.provider}, ${usage.model}, ${usage.inputTokens}, ${usage.outputTokens}, ${estimateCostUsd(usage)})
  `;
}
