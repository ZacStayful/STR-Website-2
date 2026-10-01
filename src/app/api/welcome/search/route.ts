import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { memberSearchEnabled, runSearchSlice } from "@/lib/sourcing-demand/member-search";
import { SEARCH_SLICE_MS } from "@/lib/intelligence/config";

// Batch 22, Part G: the quiz's keepalive kick. Runs one slice (about 38 s)
// of the member's own queued or running search; the cron finishes anything
// left. Only ever the signed-in member's own search.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  if (!memberSearchEnabled() || !hasServiceRole()) return Response.json({ ok: false, reason: "off" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "signed_out" }, { status: 401 });
  const { data } = await createAdminClient().from("member_searches").select("id").eq("user_id", user.id).in("status", ["queued", "running"]).order("created_at", { ascending: true }).limit(1);
  const id = (data ?? [])[0]?.id as string | undefined;
  if (!id) return Response.json({ ok: true, ran: false });
  const r = await runSearchSlice(id, { deadlineMs: SEARCH_SLICE_MS });
  return Response.json({ ok: true, ran: Boolean(r), status: r?.status ?? null, found: r?.found ?? 0 });
}
