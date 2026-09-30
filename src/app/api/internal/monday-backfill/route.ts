import { runBackfill } from "@/lib/crm/monday-funnel/sync-server";
import { authoriseAdminOrInternal, sameOrigin } from "@/lib/lifecycle/route-auth";

// Batch 20, Part F: fill every column for every member and put each row in
// its group, creating the rows that are missing (src/lib/crm/monday-funnel).
//   GET            always a dry run: for every member, current group → new
//                  group and every value it would write
//   POST           applies (needs MONDAY_FUNNEL_ENABLED=true); POST ?dry=1 is a
//                  dry run too. Stopped part-way ("more": true): POST again,
//                  it writes only what still differs.
// The internal secret or a signed-in admin. Switch the n8n trigger on only
// after this has run: it moves many rows at once.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authoriseAdminOrInternal(request);
  if (!auth.ok) return Response.json({ error: "Not found" }, { status: auth.status });
  const outcome = await runBackfill({ apply: false });
  return Response.json({ ...outcome, note: "Dry run: nothing was written. POST to apply." }, { status: outcome.error ? 500 : 200 });
}

export async function POST(request: Request) {
  const auth = await authoriseAdminOrInternal(request);
  if (!auth.ok) return Response.json({ error: "Not found" }, { status: auth.status });
  if (auth.viaSession && !sameOrigin(request)) return Response.json({ error: "Run it from the admin page." }, { status: 403 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const outcome = await runBackfill({ apply: !dry });
  return Response.json({ ...outcome, by: auth.by }, { status: outcome.error ? 500 : 200 });
}
