import { runPausedEmails } from "@/lib/listing/picks-paused-run";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── "Your picks have paused" cron ────────────────────────────────────
// Vercel cron (vercel.json: 08:20 UTC, after the daily-picks passes and the
// 08:10 digest, so the day's daily email has gone first; Batch 21 moved it
// from 08:00).
// Emails every member whose picks paused for want of credit, under the rules
// in src/lib/listing/picks-paused.ts. The run itself lives in
// src/lib/listing/picks-paused-run.ts, shared with the admin page.
//
//   ?dry=1   report who would get what; writes and sends nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/picks-paused?dry=1"
//
// Auth: Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or the shared
// internal secret for manual runs.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const result = await runPausedEmails({ dry });
  return Response.json(result.body, { status: result.status });
}
