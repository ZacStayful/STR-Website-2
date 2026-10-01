import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchStatusFor } from "@/lib/sourcing-demand/member-search";

// Batch 22: what the Stayful Intelligence view polls while a member's own search runs.
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ running: false }, { status: 401 });
  const s = await searchStatusFor(user.id);
  return Response.json({ running: s.running, purpose: s.purpose, found: s.finds.length });
}
