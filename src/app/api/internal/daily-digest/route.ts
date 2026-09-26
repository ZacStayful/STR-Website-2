import { runDailyDigest } from "@/lib/notify/digest-run";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Daily digest cron (Batch 6) ──────────────────────────────────────
// Vercel cron (vercel.json: 08:10 UTC, after the three picks passes and the
// 08:00 picks-paused letter). The daily email for everyone who has not had
// one today: Today's 5 without a pick for members with picks on, or the
// changes on deals they track. Never a second email: it claims the same one
// daily slot every other daily email does (src/lib/notify/cap.ts).
//
//   ?dry=1          who would get what; writes, chooses and sends nothing
//   ?only=<email>   one member (a real send unless dry)
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/daily-digest?dry=1"
//
// Kill switch: DAILY_DIGEST_ENABLED=false.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (process.env.DAILY_DIGEST_ENABLED === "false" && !dry) return Response.json({ enabled: false, reason: "DAILY_DIGEST_ENABLED is 'false'" });

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

  const result = await runDailyDigest({ dry, onlyUserIds });
  return Response.json(result.body, { status: result.status });
}
