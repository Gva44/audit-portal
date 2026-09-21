import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { buildQuestionnaireExport } from "@/lib/questionnaire-export";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const docRows = await sql`
    select filename, category, column_headers from documents where id = ${id}
  `;
  const doc = docRows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.category !== "questionnaire") {
    return NextResponse.json({ error: "Document is not a questionnaire" }, { status: 400 });
  }

  const questions = await sql`
    select position, question_text, row_data, answer_text, citations, answer_status
    from questions
    where document_id = ${id}
    order by position asc
  `;

  const buffer = await buildQuestionnaireExport(
    (doc.column_headers as string[] | null) ?? null,
    questions.map((q) => ({
      position: q.position as number,
      question_text: q.question_text as string,
      row_data: q.row_data as Record<string, string> | null,
      answer_text: q.answer_text as string | null,
      citations: q.citations as { id: string; filename: string }[],
      answer_status: q.answer_status as string,
    }))
  );

  const baseName = String(doc.filename).replace(/\.[^.]+$/, "");
  // exceljs's own .d.ts declares a minimal global `Buffer` (for browser compatibility)
  // that conflicts with Node's real Buffer type project-wide, including here even
  // though this file never imports exceljs directly — see src/lib/extract.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${baseName} - Answers.xlsx"`,
    },
  });
}
