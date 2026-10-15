import { sql } from "./db";

// One query shape for a question plus everything the review UI shows alongside it: last
// year's matched question/answer and who generated the answer.
export async function fetchQuestions(filter: { documentId?: string; questionId?: string }) {
  return sql`
    select q.id, q.document_id, q.position, q.question_text, q.row_data, q.expected_evidence,
           q.answer_text, q.citations, q.response_value, q.confidence_level, q.confidence_score,
           q.score, q.suggested_action, q.comparison_status, q.comparison_note, q.recommendation,
           q.source_scope, q.prior_question_id, prior.question_text as prior_question_text,
           prior.answer_text as prior_answer_text, prior.response_value as prior_response_value,
           prior_doc.filename as prior_document_filename,
           q.model_used, q.generated_by, generated_by_user.display_name as generated_by_display_name,
           q.edited_by, edited_by_user.display_name as edited_by_display_name, q.edited_at,
           q.previous_response_value, q.previous_answer_text,
           q.answer_status, q.answer_error, q.created_at
    from questions q
    left join questions prior on prior.id = q.prior_question_id
    left join documents prior_doc on prior_doc.id = prior.document_id
    left join users generated_by_user on generated_by_user.username = q.generated_by
    left join users edited_by_user on edited_by_user.username = q.edited_by
    where (${filter.documentId ?? null}::uuid is null or q.document_id = ${filter.documentId ?? null}::uuid)
      and (${filter.questionId ?? null}::uuid is null or q.id = ${filter.questionId ?? null}::uuid)
    order by q.position asc
  `;
}
