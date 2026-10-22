import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { buildQuestionnaireExport } from "@/lib/questionnaire-export";
import { fetchQuestions } from "@/lib/question-queries";
import { toExportRows } from "@/lib/export-rows";
import { asAllowed } from "@/lib/answer-format";
import type { ColumnConfig } from "@/lib/questionnaire-table";

// The client-facing file: original columns with our answers filled in, nothing internal.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const docRows = await sql`
    select filename, category, column_headers, column_config, allowed_answers from documents where id = ${id}
  `;
  const doc = docRows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.category !== "questionnaire") {
    return NextResponse.json({ error: "Document is not a questionnaire" }, { status: 400 });
  }

  const questions = await fetchQuestions({ documentId: id });
  const buffer = await buildQuestionnaireExport(
    (doc.column_headers as string[] | null) ?? null,
    toExportRows(questions),
    (doc.column_config as ColumnConfig | null) ?? null,
    asAllowed(doc.allowed_answers)
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
