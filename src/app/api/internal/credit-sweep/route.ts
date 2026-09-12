import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";
import { expireDueGrants } from "@/lib/credit/ledger";
import { syncUnitCosts } from "@/lib/credit/unit-costs";
import { ensureAnnualMonthlyGrant } from "@/lib/stripe/grants";
import { setBillingState, mondayBillingConfigured } from "@/lib/apis/monday";

// ─── Daily credit sweep ────────────────────────────────────────────────
// Vercel cron (vercel.json, 03:00 UTC). Writes 'expire' rows for plan credit
// past its cycle, grants the next monthly slot to annual subscribers, seeds
// any unit-cost rows a deploy added, and flags members who hit £0 more than
// 48 h ago without topping up or upgrading for sales follow-up in Monday.
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/credit-sweep"

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }
  const summary = { expired: 0, annualGranted: 0, seeded: 0, lapsedFlagged: 0, errors: [] as string[] };

  try {
    summary.expired = await expireDueGrants();
  } catch (err) {
    summary.errors.push(`expire: ${(err as Error).message}`);
  }

  try {
    const { data } = await admin.from("profiles").select("id").eq("plan_code", "pro_annual").not("stripe_subscription_id", "is", null);
    for (const p of data ?? []) {
      try {
        if (await ensureAnnualMonthlyGrant(String(p.id))) summary.annualGranted += 1;
      } catch (err) {
        summary.errors.push(`annual ${p.id}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    summary.errors.push(`annual: ${(err as Error).message}`);
  }

  try {
    summary.seeded = await syncUnitCosts();
  } catch (err) {
    summary.errors.push(`seed: ${(err as Error).message}`);
  }

  if (mondayBillingConfigured()) {
    try {
      const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { data } = await admin.from("profiles").select("id, email, hit_zero_at, last_topup_at, plan_code").lt("hit_zero_at", cutoff).not("email", "is", null);
      for (const p of data ?? []) {
        const hit = new Date(String(p.hit_zero_at)).getTime();
        const topped = p.last_topup_at ? new Date(String(p.last_topup_at)).getTime() : 0;
        if (topped > hit) continue;
        await setBillingState(String(p.email), { status: "Lapsed at zero", planCode: (p.plan_code as string | null) ?? null });
        summary.lapsedFlagged += 1;
      }
    } catch (err) {
      summary.errors.push(`monday: ${(err as Error).message}`);
    }
  }

  return Response.json(summary);
}
