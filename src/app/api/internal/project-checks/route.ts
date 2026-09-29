import { createAdminClient } from "@/lib/supabase/admin";
import { projectChecksOn, runProjectChecks } from "@/lib/project/check-run";
import { readProjectSettings } from "@/lib/project/settings-server";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── The Project checks (Batch 17, Part B) ────────────────────────────
// Vercel cron (vercel.json: every ten minutes from 04:25 to 05:55 UTC, after
// Batch 16's comparables checks at 03:40–04:20). Each pass re-costs any live
// Project deal whose price has moved, makes at most one photo check (the
// best-ranked candidate prepped today) and preps the next candidates (a
// page read, the free tests, the planning checks and the sold prices), all
// within the day's allowance and spend line. The run lives in
// src/lib/project/check-run.ts, shared with /admin/deals.
//
// OFF until billing_settings.project_checks.enabled is on AND Batch 16's
// DEAL_CHECKS_ENABLED=true (Project candidates wait on its shortlist). A
// dry run works either way.
//
//   ?dry=1    the day's allowance and spend line, what is waiting, the next
//             photo check and its worst-case cost, what this pass would prep
//             (area, bedrooms, type, the best case: never an address); asks
//             nothing, writes nothing
//   ?max=n    prep at most n candidates this pass (the photo check is
//             always at most one)
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/project-checks?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  if (!dry) {
    let on = false;
    try {
      on = projectChecksOn(await readProjectSettings(createAdminClient()));
    } catch {
      return Response.json({ error: "Storage not configured" }, { status: 503 });
    }
    if (!on) return Response.json({ enabled: false, reason: "project_checks.enabled is off, or DEAL_CHECKS_ENABLED is not 'true'" });
  }
  const max = Number(params.get("max"));
  const result = await runProjectChecks({
    dry,
    maxPreps: Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined,
    // Vercel's cron sends the CRON_SECRET bearer; a hand-run curl sends x-internal-secret.
    triggeredBy: request.headers.get("authorization") ? "cron" : "internal",
  });
  return Response.json(result.body, { status: result.status });
}
