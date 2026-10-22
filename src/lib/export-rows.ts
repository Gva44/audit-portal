import type { QuestionExportRow } from "./questionnaire-export";

type Row = Record<string, unknown>;

// Maps the joined question rows from fetchQuestions onto the shape the exporters take.
export function toExportRows(rows: Row[]): QuestionExportRow[] {
  return rows.map((q) => ({
    position: q.position as number,
    question_text: q.question_text as string,
    row_data: q.row_data as Record<string, string> | null,
    answer_text: q.answer_text as string | null,
    citations: (q.citations as QuestionExportRow["citations"]) ?? [],
    response_value: q.response_value as string | null,
    confidence_level: q.confidence_level as string | null,
    confidence_score: q.confidence_score as string | number | null,
    score: q.score as string | number | null,
    suggested_action: q.suggested_action as string | null,
    answer_status: q.answer_status as string,
    expected_evidence: q.expected_evidence as string | null,
    comparison_status: q.comparison_status as string | null,
    comparison_note: q.comparison_note as string | null,
    recommendation: q.recommendation as string | null,
    source_scope: q.source_scope as string | null,
    prior_response_value: q.prior_response_value as string | null,
    prior_answer_text: q.prior_answer_text as string | null,
    generated_by_display_name: (q.generated_by_display_name as string | null) ?? (q.generated_by as string | null),
    answer_format: q.answer_format as string | null,
    gap_note: q.gap_note as string | null,
    documents_to_add: (q.documents_to_add as string[] | null) ?? null,
    edited_by_display_name: q.edited_by ? ((q.edited_by_display_name as string | null) ?? (q.edited_by as string)) : null,
  }));
}
