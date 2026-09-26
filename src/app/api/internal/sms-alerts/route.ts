import { runSmsAlerts } from "@/lib/sms/alerts-run";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Text alerts (Batch 8) ─────────────────────────────────────────────
// Vercel cron (vercel.json: every 15 minutes, 07:00–19:45 UTC; the run
// itself only sends 08:00–20:00 UK time, so the clock change needs no edit).
// At most one text per member per day, and the monthly cap, through Batch 6's
// send record. Reads Batch 6's alerts, which the collector
// (/api/internal/deal-alerts) records hourly in the day.
//
//   ?dry=1          what would be texted, to whom; claims, records and sends nothing
//   ?dry=1&anytime=1  the same outside 08:00–20:00 (dry runs only)
//   ?only=<email>   one member
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/sms-alerts?dry=1"
//
// Sends nothing unless SMS_ALERTS_ENABLED=true and Twilio is configured.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  const ignoreWindow = dry && params.get("anytime") === "1";

  let onlyUserIds: string[] | undefined;
  const only = params.get("only")?.trim().toLowerCase();
  if (only) {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return Response.json({ error: "Storage not configured" }, { status: 503 });
    }
    const { data } = await admin.from("profiles").select("id").ilike("email", only).limit(1);
    const id = data?.[0]?.id as string | undefined;
    if (!id) return Response.json({ error: "No member with that email" }, { status: 404 });
    onlyUserIds = [id];
  }

  const result = await runSmsAlerts({ dry, onlyUserIds, ignoreWindow });
  return Response.json(result.body, { status: result.status });
}
