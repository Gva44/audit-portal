import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Everything the home page shows, in one request. `client` narrows the lists below the
// cards: "all" (default), "general", or a client id. The cards themselves always cover
// every client so the team can see the whole picture at a glance.
export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("client") ?? "all";

  const clients = await sql`select id, name from clients order by name asc`;

  const questionnaires = await sql`
    select d.id, d.filename, d.client_id, c.name as client_name, d.created_at,
           count(q.id)::int as total,
           count(*) filter (where q.answer_status = 'ok')::int as answered,
           count(*) filter (where q.answer_status = 'ok' and q.score >= 8)::int as ready,
           count(*) filter (where q.answer_status = 'ok' and q.score >= 5 and q.score < 8)::int as update_needed,
           count(*) filter (where q.answer_status = 'ok' and q.score < 5)::int as recheck,
           count(*) filter (where q.answer_status = 'failed')::int as failed,
           count(*) filter (where q.answer_status = 'ok' and lower(q.response_value) in ('na', 'n/a', 'no'))::int as needs_it,
           max(q.updated_at) as last_activity
    from documents d
    left join clients c on c.id = d.client_id
    left join questions q on q.document_id = d.id
    where d.category = 'questionnaire'
    group by d.id, c.name
    order by max(q.updated_at) desc nulls last, d.created_at desc
  `;

  const docCounts = await sql`
    select client_id,
           count(*) filter (where category = 'policy')::int as policies,
           count(*) filter (where category = 'evidence')::int as evidence,
           count(*) filter (where extraction_status = 'failed')::int as extraction_failed,
           max(created_at) as last_upload
    from documents
    where category in ('policy', 'evidence')
    group by client_id
  `;

  const inScope = (clientId: string | null) =>
    scope === "all" || (scope === "general" ? clientId === null : clientId === scope);

  // ----- cards: one per client plus General -----
  type Card = {
    id: string;
    name: string;
    shared: boolean;
    questionnaires: number;
    total: number;
    answered: number;
    ready: number;
    updateNeeded: number;
    recheck: number;
    policies: number;
    evidence: number;
    lastActivity: string | null;
    latestQuestionnaireId: string | null;
  };
  const makeCard = (id: string, name: string, clientId: string | null, shared: boolean): Card => {
    const own = questionnaires.filter((d) => (d.client_id as string | null) === clientId);
    const counts = docCounts.find((d) => (d.client_id as string | null) === clientId);
    const stamps = [
      ...own.map((d) => d.last_activity as string | null),
      counts ? (counts.last_upload as string | null) : null,
    ].filter(Boolean) as string[];
    return {
      id,
      name,
      shared,
      questionnaires: own.length,
      total: own.reduce((s, d) => s + (d.total as number), 0),
      answered: own.reduce((s, d) => s + (d.answered as number), 0),
      ready: own.reduce((s, d) => s + (d.ready as number), 0),
      updateNeeded: own.reduce((s, d) => s + (d.update_needed as number), 0),
      recheck: own.reduce((s, d) => s + (d.recheck as number), 0),
      policies: counts ? (counts.policies as number) : 0,
      evidence: counts ? (counts.evidence as number) : 0,
      lastActivity: stamps.length ? stamps.sort().at(-1)! : null,
      latestQuestionnaireId: own.length ? (own[0].id as string) : null,
    };
  };
  const cards = [
    ...clients.map((c) => makeCard(c.id as string, c.name as string, c.id as string, false)),
    makeCard("general", "General", null, true),
  ];

  // ----- continue where you left off -----
  const continueList = questionnaires
    .filter((d) => inScope((d.client_id as string | null) ?? null))
    .slice(0, 8)
    .map((d) => ({
      id: d.id as string,
      filename: d.filename as string,
      clientName: (d.client_name as string | null) ?? "General",
      total: d.total as number,
      answered: d.answered as number,
      ready: d.ready as number,
      updateNeeded: d.update_needed as number,
      recheck: d.recheck as number,
      lastActivity: (d.last_activity as string | null) ?? (d.created_at as string),
    }));

  // ----- needs attention -----
  type Attention = { kind: string; text: string; href: string; questionnaire?: string };
  const attention: Attention[] = [];
  for (const d of questionnaires) {
    if (!inScope((d.client_id as string | null) ?? null)) continue;
    const name = `${(d.client_name as string | null) ?? "General"} · ${d.filename}`;
    const href = `/questionnaires/${d.id}`;
    if ((d.total as number) === 0) continue;
    if ((d.answered as number) === 0) {
      attention.push({ kind: "empty", text: `No answers yet (${d.total} questions)`, href, questionnaire: name });
      continue;
    }
    if ((d.failed as number) > 0) {
      attention.push({ kind: "failed", text: `${d.failed} answers failed, generate them again`, href, questionnaire: name });
    }
    const unanswered = (d.total as number) - (d.answered as number) - (d.failed as number);
    if (unanswered > 0) {
      attention.push({ kind: "pending", text: `${unanswered} questions still unanswered`, href, questionnaire: name });
    }
    if ((d.needs_it as number) > 0) {
      attention.push({
        kind: "low",
        text: `${d.needs_it} answers may not apply or need IT input before the client file goes out`,
        href,
        questionnaire: name,
      });
    }
    if ((d.recheck as number) > 0) {
      attention.push({ kind: "low", text: `${d.recheck} answers scoring below 5, review these first`, href, questionnaire: name });
    }
  }
  const failedDocs = await sql`
    select d.id, d.filename, d.client_id, c.name as client_name
    from documents d left join clients c on c.id = d.client_id
    where d.extraction_status = 'failed'
    order by d.created_at desc limit 10
  `;
  for (const d of failedDocs) {
    if (!inScope((d.client_id as string | null) ?? null)) continue;
    attention.push({
      kind: "extraction",
      text: `Could not read the text of ${d.filename}`,
      href: "/library",
      questionnaire: (d.client_name as string | null) ?? "General",
    });
  }

  // ----- recent activity (answers, edits, uploads) -----
  type Activity = { at: string; text: string; href: string };
  const activity: Activity[] = [];

  const answered = await sql`
    select q.document_id, d.filename, d.client_id, c.name as client_name,
           coalesce(u.display_name, q.generated_by, 'Someone') as who,
           count(*)::int as n, max(q.updated_at) as at
    from questions q
    join documents d on d.id = q.document_id
    left join clients c on c.id = d.client_id
    left join users u on u.username = q.generated_by
    where q.answer_status = 'ok' and q.edited_by is null and q.updated_at > q.created_at + interval '1 minute'
      and q.updated_at > now() - interval '30 days'
    group by q.document_id, d.filename, d.client_id, c.name, who, date_trunc('hour', q.updated_at)
    order by max(q.updated_at) desc limit 15
  `;
  for (const a of answered) {
    if (!inScope((a.client_id as string | null) ?? null)) continue;
    activity.push({
      at: a.at as string,
      text: `${a.who} answered ${a.n} ${a.n === 1 ? "question" : "questions"} on ${(a.client_name as string | null) ?? "General"} · ${a.filename}`,
      href: `/questionnaires/${a.document_id}`,
    });
  }

  const edited = await sql`
    select q.document_id, q.position, d.filename, d.client_id, c.name as client_name,
           coalesce(u.display_name, q.edited_by) as who, q.edited_at as at
    from questions q
    join documents d on d.id = q.document_id
    left join clients c on c.id = d.client_id
    left join users u on u.username = q.edited_by
    where q.edited_by is not null and q.edited_at > now() - interval '30 days'
    order by q.edited_at desc limit 15
  `;
  for (const e of edited) {
    if (!inScope((e.client_id as string | null) ?? null)) continue;
    activity.push({
      at: e.at as string,
      text: `${e.who} edited question ${Number(e.position) + 1} on ${(e.client_name as string | null) ?? "General"} · ${e.filename}`,
      href: `/questionnaires/${e.document_id}`,
    });
  }

  const uploads = await sql`
    select d.id, d.filename, d.category, d.client_id, c.name as client_name, d.created_at as at,
           coalesce(u.display_name, d.uploaded_by) as who
    from documents d
    left join clients c on c.id = d.client_id
    left join users u on u.username = d.uploaded_by
    where d.created_at > now() - interval '30 days'
    order by d.created_at desc limit 15
  `;
  for (const d of uploads) {
    if (!inScope((d.client_id as string | null) ?? null)) continue;
    activity.push({
      at: d.at as string,
      text: `${d.who ?? "Someone"} uploaded ${d.filename} (${d.category}) to ${(d.client_name as string | null) ?? "General"}`,
      href: d.category === "questionnaire" ? `/questionnaires/${d.id}` : "/library",
    });
  }
  activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return NextResponse.json({
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    cards,
    continueList,
    attention: attention.slice(0, 12),
    activity: activity.slice(0, 10),
  });
}
