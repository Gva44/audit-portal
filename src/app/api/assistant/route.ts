import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { checkAiAccess, logAiUsage } from "@/lib/ai-control";
import { DOCUMENT_ACTIONS, QUESTION_ACTIONS, runAssistant, type AssistantAction } from "@/lib/assistant";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  const access = await checkAiAccess(user, "assist");
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.status });

  const body = await request.json().catch(() => ({}));
  const action = body.action as AssistantAction;
  if (![...QUESTION_ACTIONS, ...DOCUMENT_ACTIONS].includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const result = await runAssistant({
      action,
      questionId: typeof body.questionId === "string" ? body.questionId : undefined,
      documentId: typeof body.documentId === "string" ? body.documentId : undefined,
      policyId: typeof body.policyId === "string" ? body.policyId : undefined,
      ask: typeof body.ask === "string" ? body.ask : undefined,
    });
    await logAiUsage(user!.username, `assistant:${action}`, result.usage);
    return NextResponse.json({
      title: result.title,
      text: result.text,
      modelUsed: result.modelUsed,
      downloadable: result.downloadable,
      proposed: result.proposed ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The assistant could not complete that." }, { status: 500 });
  }
}
