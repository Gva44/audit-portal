import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { setSetting } from "@/lib/ai-control";

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser(request);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));

  if (typeof body.generateEnabled === "boolean") await setSetting("generate_enabled", String(body.generateEnabled));
  if (typeof body.assistEnabled === "boolean") await setSetting("assist_enabled", String(body.assistEnabled));
  if ("monthlyCapUsd" in body) {
    const cap = Number(body.monthlyCapUsd);
    await setSetting("monthly_cap_usd", body.monthlyCapUsd === null || !Number.isFinite(cap) || cap <= 0 ? null : String(cap));
  }
  return NextResponse.json({ ok: true });
}
