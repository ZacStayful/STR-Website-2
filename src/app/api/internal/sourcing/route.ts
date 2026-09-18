import { runDailyPicks, sendingEnabled } from "@/lib/listing/picks-run";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Daily picks cron ─────────────────────────────────────────────────
// Vercel cron (vercel.json: 07:00 UTC, with a resumable second pass at 07:20).
// Sending is ON unless SOURCING_ENABLED=false, the kill switch. The run itself
// lives in src/lib/listing/picks-run.ts, shared with the admin page.
//
//   ?dry=1          report who would get what; writes and sends nothing, and
//                   works while sending is off
//   ?only=<email>   restrict the run to one member (a real send unless dry)
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/sourcing?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (!sendingEnabled() && !dry) return Response.json({ enabled: false, reason: "SOURCING_ENABLED is 'false'" });

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

  const result = await runDailyPicks({ dry, onlyUserIds });
  return Response.json(result.body, { status: result.status });
}
