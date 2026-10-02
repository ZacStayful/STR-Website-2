import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ownerIdOrNull } from '@/lib/leads/scope';
import { stampManagement } from '@/lib/management/stamp-server';
import { SETUP_PATH } from '@/lib/management/stamp';

/**
 * Batch 22f: the way in to the lead form setup — the management page's
 * Start, the quiz's "Set up your branded lead form instead" and Account's
 * link. Signed out: sign up first, and come back here. Signed in: the
 * account is stamped as a management company (once; the first way in is
 * the one kept) and sent to the setup.
 *
 * A route of its own, outside /leads, because the stamp has to be on the
 * account BEFORE the Leads layout's shell decides whether to send them to
 * the quiz. A team seat is never stamped: it works its owner's leads.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const via = url.searchParams.get('via');
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const back = `${url.pathname}${via ? `?via=${encodeURIComponent(via)}` : ''}`;
    return NextResponse.redirect(new URL(`/signup?next=${encodeURIComponent(back)}`, url.origin));
  }
  if (!(await ownerIdOrNull(user))) return NextResponse.redirect(new URL('/leads', url.origin));
  await stampManagement(user.id, via === 'account' ? 'account' : via === 'quiz' ? 'quiz' : 'start');
  return NextResponse.redirect(new URL(SETUP_PATH, url.origin));
}
