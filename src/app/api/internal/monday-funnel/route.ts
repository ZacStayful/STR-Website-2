import { runFunnelCron } from "@/lib/crm/monday-funnel/sync-server";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Monday sales funnel + inactivity (Batch 20, Parts C and F) ────────
// Vercel cron (vercel.json: every 10 minutes). Each run drains the Monday
// queue (members an event touched); from 06:00 UK it also runs the nightly:
// the inactivity step first (database only, before the 07:00 UTC picks run),
// then every member's row and group, carrying on across runs until done.
// The UK hour is read in code, so the clock change needs no edit.
//
//   ?dry=1              what the queue and the nightly would do; writes nothing
//                       (not the board, the queue, the lease or the inactivity marks)
//   ?nightly=force      the nightly now, whatever the hour (again if already done)
//   ?nightly=skip       the queue only
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/monday-funnel?dry=1&nightly=force"
//
// Monday writes need MONDAY_API_KEY and MONDAY_FUNNEL_ENABLED=true; the
// inactivity step runs either way. Auth: Vercel Cron's bearer, or the
// shared internal secret.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  const nightly = params.get("nightly");
  const result = await runFunnelCron({ dry, nightly: nightly === "force" || nightly === "skip" ? nightly : "auto" });
  return Response.json(result);
}
