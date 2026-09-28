import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/safe-path";
import { switchProfile } from "@/lib/profiles/server";

/**
 * Where a profile's links in the daily email land ("Open Today" under
 * Client: JS): switch the member to that profile, then go on. Needs the
 * member's own session (signed out: sign in first, then back here), and it
 * only changes which profile the header shows: it never charges, pauses or
 * deletes anything, so a mail scanner fetching the link (it has no session)
 * does nothing at all. An id that is not the member's is ignored.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeInternalPath(url.searchParams.get("next"), "/today");
  const to = url.searchParams.get("to") ?? "";
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const back = `${url.pathname}${url.search}`;
    return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(back)}`, url.origin));
  }
  if (/^[0-9a-f-]{36}$/i.test(to)) await switchProfile(user.id, to);
  return NextResponse.redirect(new URL(next, url.origin));
}
