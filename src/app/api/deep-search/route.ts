import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deepQuoteFor, runSearchSlice, startDeepSearch } from "@/lib/sourcing-demand/member-search";
import { SEARCH_SLICE_MS } from "@/lib/intelligence/config";

// Batch 22, Part G: the paid deep search, started by the member.
//   POST { action: "quote" }                 → about / up to, first-time discount
//   POST { action: "start", upToBasePence }  → re-quoted here; the "up to" is
//                                              reserved first; one slice runs now
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "signed_out" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; upToBasePence?: unknown };
  if (body.action === "quote") {
    const q = await deepQuoteFor(user.id);
    return Response.json(q ? { ok: true, quote: q } : { ok: false, reason: "off" });
  }
  if (body.action === "start") {
    const seen = Number(body.upToBasePence);
    if (!Number.isFinite(seen) || seen < 0) return Response.json({ ok: false, reason: "quote_changed" }, { status: 400 });
    const r = await startDeepSearch(user.id, seen);
    if (!r.ok) return Response.json(r, { status: r.reason === "credit" ? 402 : 409 });
    const slice = await runSearchSlice(r.id, { deadlineMs: SEARCH_SLICE_MS });
    return Response.json({ ok: true, id: r.id, status: slice?.status ?? "running" });
  }
  return Response.json({ ok: false, reason: "bad_request" }, { status: 400 });
}
