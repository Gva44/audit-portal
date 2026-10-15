import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getAiSettings } from "@/lib/ai-control";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const settings = await getAiSettings();
  return NextResponse.json({
    user: {
      ...user,
      // What this person can actually use right now: their own permission AND the master switch.
      canGenerate: user.canGenerate && settings.generateEnabled,
      canAssist: user.canAssist && settings.assistEnabled,
    },
  });
}
