import { runBtlScreen } from "@/lib/btl/screen-server";
import { btlScreenEnabled } from "@/lib/btl/settings-server";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── The nightly buy-to-let screen (Batch 28, Parts A and C) ─────────
// Vercel cron (vercel.json: 04:50 UTC, after market-warm buys the key stats
// and the day's mortgage rate, and 06:57, after the sweep, before the 07:00
// picks). Screens every sale seen this week for buy-to-let from data already
// held, buys the day's short paid shortlist (rent valuations and EPCs) inside
// its own line of Batch 16's cap (deal_checks: btlValuations, btlCapPence),
// writes each deal's lens, lets in or retires buy-to-let-only rows, and
// stores the benchmarks. The run lives in src/lib/btl/screen-server.ts.
//
// OFF until BTL_SCREEN_ENABLED=true. A dry run works either way.
//
//   ?dry=1    what it would write, let in, bring back and retire; the
//             shortlist it would buy (outcode, size and why: never an
//             address) and what the day's cap has left; asks nothing that
//             costs, writes nothing
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/btl-screen?dry=1"

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  if (!btlScreenEnabled() && !dry) return Response.json({ enabled: false, reason: "BTL_SCREEN_ENABLED is not 'true'" });
  const result = await runBtlScreen({
    dry,
    // Vercel's cron sends the CRON_SECRET bearer; a hand-run curl sends x-internal-secret.
    triggeredBy: request.headers.get("authorization") ? "cron" : "internal",
  });
  return Response.json(result.body, { status: result.status });
}
