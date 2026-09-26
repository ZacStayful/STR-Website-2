import { runYourWeek } from "@/lib/notify/week-run";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── "Your week" (Batch 6), was the weekly area digest ────────────────
// Vercel cron (vercel.json, Monday 08:00 UTC). Up to three sections — deals
// you missed, your deals this week, your areas — each only when it has
// something to say and its switch is on; see src/lib/notify/week.ts. The
// area section keeps the digest's rules: the first run after saving only
// records a baseline, and nothing is recorded when the send failed.
//
//   ?dry=1          who would get what; claims, records and sends nothing
//                   (works on any day; a real run sends only on Mondays)
//   ?only=<email>   one member
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/alerts?dry=1"
//
// Auth: Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or the shared
// internal secret for manual runs.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";

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

  const result = await runYourWeek({ dry, onlyUserIds });
  return Response.json(result.body, { status: result.status });
}
