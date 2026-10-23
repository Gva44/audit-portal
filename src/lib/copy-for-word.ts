// Paste-ready text for the client's own document. The client file is an Excel export, so when
// the client's original is Word, the team copies the answers across. This builds a table that
// pastes straight into Word (as a table) or into Excel/Notepad (as tab-separated text).

export type CopyRow = {
  no: string;
  question?: string;
  response?: string;
  remark: string;
  evidence?: string;
};

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

export function buildCopy(
  rows: CopyRow[],
  opts: { includeQuestion: boolean; includeResponse: boolean; includeEvidence: boolean }
): { html: string; text: string } {
  const headers = ["No."];
  if (opts.includeQuestion) headers.push("Question");
  if (opts.includeResponse) headers.push("Yes / No");
  headers.push("Remark");
  if (opts.includeEvidence) headers.push("Evidence");

  const cells = (r: CopyRow): string[] => {
    const c = [r.no];
    if (opts.includeQuestion) c.push((r.question ?? "").replace(/\s+/g, " ").trim());
    if (opts.includeResponse) c.push(r.response ?? "");
    c.push(r.remark.replace(/\n/g, " / "));
    if (opts.includeEvidence) c.push(r.evidence ?? "");
    return c;
  };

  const text = [headers, ...rows.map(cells)].map((row) => row.map((v) => v.replace(/\t/g, " ")).join("\t")).join("\n");
  const td = "border:1px solid #999;padding:4px 8px;vertical-align:top;font-family:Calibri,Arial,sans-serif;font-size:11pt";
  const html =
    `<table style="border-collapse:collapse"><thead><tr>${headers
      .map((h) => `<th style="${td};background:#e8e8e8;text-align:left">${esc(h)}</th>`)
      .join("")}</tr></thead><tbody>` +
    rows
      .map((r) => `<tr>${cells(r).map((v) => `<td style="${td}">${esc(v)}</td>`).join("")}</tr>`)
      .join("") +
    "</tbody></table>";
  return { html, text };
}
