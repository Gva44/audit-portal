// Older questionnaires were saved before expected_evidence was stored per row, so look for
// a column that names required evidence (common in bank DD questionnaires, e.g.
// "Documents / Information Needed").
const EVIDENCE_HEADER_PATTERN = /evidence|document.*need|information.*need|required/i;

export function findExpectedEvidence(rowData: Record<string, string> | null | undefined): string | null {
  if (!rowData) return null;
  for (const [header, value] of Object.entries(rowData)) {
    if (EVIDENCE_HEADER_PATTERN.test(header) && typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
