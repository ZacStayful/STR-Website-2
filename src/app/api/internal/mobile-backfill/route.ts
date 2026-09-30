import { runMobileBackfill } from "@/lib/credit/mobile-backfill-server";
import { authoriseAdminOrInternal, sameOrigin } from "@/lib/lifecycle/route-auth";

// Batch 20, Part D: claim every existing account's mobile number, the oldest
// account keeping a shared one (src/lib/credit/mobile-claims.ts).
//   GET            always a dry run: counts, and every shared number with each
//                  account's email, created date, welcome credit and spend
//   POST           applies; POST ?dry=1 is a dry run too
// The internal secret or a signed-in admin. Safe to repeat.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authoriseAdminOrInternal(request);
  if (!auth.ok) return Response.json({ error: "Not found" }, { status: auth.status });
  const outcome = await runMobileBackfill({ apply: false });
  if (!outcome.ok) return Response.json({ dry: true, error: outcome.message }, { status: 500 });
  return Response.json({ ...outcome.result, note: "Dry run: nothing was written. POST to apply." });
}

export async function POST(request: Request) {
  const auth = await authoriseAdminOrInternal(request);
  if (!auth.ok) return Response.json({ error: "Not found" }, { status: auth.status });
  if (auth.viaSession && !sameOrigin(request)) return Response.json({ error: "Run it from the admin page." }, { status: 403 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const outcome = await runMobileBackfill({ apply: !dry });
  if (!outcome.ok) return Response.json({ dry, error: outcome.message }, { status: 500 });
  return Response.json({ ...outcome.result, by: auth.by });
}
