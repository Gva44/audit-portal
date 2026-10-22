import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { buildReviewReport } from "@/lib/questionnaire-export";
import { fetchQuestions } from "@/lib/question-queries";
import { asAllowed, resolveAllowed } from "@/lib/answer-format";
import { toExportRows } from "@/lib/export-rows";

// The internal IT review report: scores, last-time comparison, recommendations and
// evidence found per question. Not for the client.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const docRows = await sql`
    select d.filename, d.category, c.name as client_name, d.allowed_answers, d.column_headers, d.column_config
    from documents d left join clients c on c.id = d.client_id
    where d.id = ${id}
  `;
  const doc = docRows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.category !== "questionnaire") {
    return NextResponse.json({ error: "Document is not a questionnaire" }, { status: 400 });
  }

  const questions = await fetchQuestions({ documentId: id });
  const buffer = await buildReviewReport(
    (doc.client_name as string | null) ?? null,
    doc.filename as string,
    toExportRows(questions),
    resolveAllowed(
      asAllowed(doc.allowed_answers),
      (doc.column_headers as string[] | null) ?? null,
      ((doc.column_config as { responseCol?: number | null } | null)?.responseCol ?? null)
    )
  );

  const baseName = String(doc.filename).replace(/\.[^.]+$/, "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see export/route.ts
  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${baseName} - IT Review Report.xlsx"`,
    },
  });
}
