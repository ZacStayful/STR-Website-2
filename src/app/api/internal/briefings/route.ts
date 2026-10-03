import { runBriefings } from "@/lib/briefing/runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailKey } from "@/lib/supabase/email-key";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Morning briefing pass (Batch 23b) ────────────────────────────────
// Vercel cron (vercel.json: 06:40 and 06:55 UTC, before the picks passes at
// 07:00 to 07:50 and the 08:10 digest). Writes each member's briefing for the
// UK day into member_briefings; the daily email and Today read it. The second
// run carries on with members the first did not reach.
//
//   ?dry=1                    every opener, subject, the facts used and the
//                             charge it would make; stores and charges nothing
//                             (the model is still called, as house spend)
//   ?only=<email>             one member (real unless dry)
//   ?model=claude-sonnet-5-5  dry only: the model trial
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/briefings?dry=1"
//
// Kill switches: BRIEFINGS_PASS_ENABLED=false stops the pass (the emails then
// carry no briefing at all); /admin/billing "AI briefings on" off gives
// template openers and charges nothing.

export const runtime = "nodejs";
export const maxDuration = 60;

const TRIAL_MODELS = new Set(["claude-haiku-4-5", "claude-sonnet-5-5"]);

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (process.env.BRIEFINGS_PASS_ENABLED === "false" && !dry) return Response.json({ enabled: false, reason: "BRIEFINGS_PASS_ENABLED is 'false'" });
  const model = params.get("model")?.trim() || undefined;
  if (model && (!dry || !TRIAL_MODELS.has(model))) return Response.json({ error: "model= is for dry runs, and only claude-haiku-4-5 or claude-sonnet-5-5" }, { status: 400 });

  let onlyUserIds: string[] | undefined;
  const only = params.get("only")?.trim().toLowerCase();
  if (only) {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return Response.json({ error: "Storage not configured" }, { status: 503 });
    }
    const { data } = await admin.from("profiles").select("id").eq("email", emailKey(only)).limit(1);
    const id = data?.[0]?.id as string | undefined;
    if (!id) return Response.json({ error: "No member with that email" }, { status: 404 });
    onlyUserIds = [id];
  }

  try {
    const result = await runBriefings({ dry, onlyUserIds, model });
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[briefing] run failed:", err);
    return Response.json({ error: "Briefing run failed" }, { status: 500 });
  }
}
