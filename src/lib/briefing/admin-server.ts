import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { addDays, ukDay } from '../activity/week';
import { summariseDays, type BriefingDay, type BriefingRowLite } from './admin';

export type BriefingsAdminStatus = 'ok' | 'no_service_role' | 'schema_missing' | 'failed';

export interface BriefingsAdmin {
  status: BriefingsAdminStatus;
  message: string | null;
  days: BriefingDay[];
  /** The latest rejections, newest first: what the validator caught. */
  rejections: { day: string; angle: string | null; reason: string }[];
}

/** The last `daysBack` UK days of briefings. */
export async function loadBriefingsAdmin(daysBack = 14, now: Date = new Date()): Promise<BriefingsAdmin> {
  if (!hasServiceRole()) return { status: 'no_service_role', message: null, days: [], rejections: [] };
  const from = addDays(ukDay(now), -(daysBack - 1));
  const rows: (BriefingRowLite & { angle: string | null; reject_reason: string | null })[] = [];
  const admin = createAdminClient();
  for (let start = 0; ; start += 1000) {
    const { data, error } = await admin
      .from('member_briefings')
      .select('uk_day, status, ai_attempted, shown_in_app_at, seen_email_at, played_count, feedback, charge_pence, input_tokens, output_tokens, angle, reject_reason')
      .gte('uk_day', from)
      .order('uk_day', { ascending: false })
      .order('id')
      .range(start, start + 999);
    if (error) return { status: /does not exist|schema cache/i.test(error.message) ? 'schema_missing' : 'failed', message: error.message, days: [], rejections: [] };
    rows.push(...((data ?? []) as typeof rows));
    if ((data?.length ?? 0) < 1000) break;
  }
  const rejections = rows.filter((r) => r.status === 'template' && r.ai_attempted && r.reject_reason).slice(0, 20).map((r) => ({ day: r.uk_day, angle: r.angle, reason: r.reject_reason! }));
  return { status: 'ok', message: null, days: summariseDays(rows), rejections };
}
