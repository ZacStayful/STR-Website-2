import { runCollector } from "@/lib/notify/alerts-collect";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Tracked-deal alerts collector (Batch 6) ──────────────────────────
// Vercel cron (vercel.json: 06:55 UTC, after listing-recheck at 06:00,
// marketplace-recheck at 06:30 and the sweep's last pass at 06:50, before the
// 07:00 picks run). Records, per member, the price drops, deals back on the
// market, deals getting attention and deals gone on what they track, into
// deal_alerts. Sends nothing: the daily email carries them. Idempotent.
//
//   ?dry=1          what would be recorded; writes nothing
//   ?only=<email>   one member
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/deal-alerts?dry=1"
//
// Kill switch: DEAL_ALERTS_ENABLED=false.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (process.env.DEAL_ALERTS_ENABLED === "false" && !dry) return Response.json({ enabled: false, reason: "DEAL_ALERTS_ENABLED is 'false'" });

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

  const result = await runCollector({ dry, onlyUserIds });
  return Response.json(result.body, { status: result.status });
}
