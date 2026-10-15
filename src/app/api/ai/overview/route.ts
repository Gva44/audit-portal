import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getAiSettings } from "@/lib/ai-control";

// Administrator view of AI usage: the live DeepSeek balance plus this month's calls,
// tokens and estimated spend, so nobody has to log in to DeepSeek to check.
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getAiSettings();

  let balance: { currency: string; total: string; available: boolean } | null = null;
  let balanceError: string | null = null;
  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`DeepSeek returned ${res.status}`);
    const data = await res.json();
    const info = data.balance_infos?.[0];
    balance = { currency: info?.currency ?? "USD", total: info?.total_balance ?? "0", available: !!data.is_available };
  } catch (err) {
    balanceError = err instanceof Error ? err.message : "Could not read the DeepSeek balance";
  }

  const totals = await sql`
    select count(*)::int as calls,
           coalesce(sum(input_tokens), 0)::bigint as input_tokens,
           coalesce(sum(output_tokens), 0)::bigint as output_tokens,
           coalesce(sum(est_cost_usd), 0)::float as cost
    from ai_usage where created_at >= date_trunc('month', now())
  `;
  const byFeature = await sql`
    select case when feature like 'assistant:%' then 'AI assistant' when feature = 'answer' then 'Answer generation' else feature end as label,
           count(*)::int as calls, coalesce(sum(est_cost_usd), 0)::float as cost,
           count(*) filter (where provider = 'gemini')::int as backup_calls
    from ai_usage where created_at >= date_trunc('month', now())
    group by 1 order by cost desc, calls desc
  `;
  const byUser = await sql`
    select coalesce(u.display_name, a.username, 'Unknown') as name, count(*)::int as calls, coalesce(sum(a.est_cost_usd), 0)::float as cost
    from ai_usage a left join users u on u.username = a.username
    where a.created_at >= date_trunc('month', now())
    group by 1 order by cost desc, calls desc
  `;

  return NextResponse.json({
    settings,
    balance,
    balanceError,
    month: {
      calls: totals[0].calls,
      inputTokens: Number(totals[0].input_tokens),
      outputTokens: Number(totals[0].output_tokens),
      cost: Number(totals[0].cost),
    },
    byFeature,
    byUser,
  });
}
