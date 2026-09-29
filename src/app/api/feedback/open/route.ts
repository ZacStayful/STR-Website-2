import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { LIMITS } from '@/lib/feedback/config';
import { feedbackSettings } from '@/lib/feedback/settings-server';
import { remainingToday } from '@/lib/feedback/server';

export const dynamic = 'force-dynamic';

/**
 * The feedback form was opened (Batch 18): logs feedback_opened and answers
 * with what the form needs to know: the limits from billing_settings, and
 * how many reports this member may still send today (null when that cannot
 * be read; the send itself is the check that counts). Members only: whose
 * form it is comes from the session.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'signed_out' }, { status: 401 });
  const settings = await feedbackSettings();
  const remaining = await remainingToday(user.id, settings.dailyLimit);
  logActivity(user.id, 'feedback_opened');
  return Response.json({
    dailyLimit: settings.dailyLimit,
    remaining,
    maxScreenshots: settings.maxScreenshots,
    screenshotMaxMb: settings.screenshotMaxMb,
    textMax: LIMITS.textMax,
  });
}
