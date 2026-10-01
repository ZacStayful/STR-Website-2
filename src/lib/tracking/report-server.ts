import 'server-only';

/**
 * What /admin/signups reads (Batch 19). Service role only; the page checks
 * the admin session first. Nothing here changes anything.
 *
 *   loadSignupReport  signup_source_facts for the range, and Batch 9's weekly
 *                     active figures (activity_weekly_facts through
 *                     computeWeeklyActive, its drill-down stretched over the
 *                     range) for weeks 2–4
 *   loadMetaStatus    which settings are present (yes/no, never a value) and
 *                     the last 20 conversions, with no member named
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { emailKey } from '../supabase/email-key';
import { COUNTED_KINDS, QUALIFYING_KINDS } from '../activity/kinds';
import { computeWeeklyActive, exclusionFor, type WeeklyFacts } from '../activity/metrics';
import { metaStatus } from '../meta/env';
import { buildSignupReport, weeksToCover, type ActiveWeeks, type SignupFact, type SignupReport } from './report';

export type LoadStatus = 'ok' | 'no_service_role' | 'schema_missing' | 'failed';

function schemaMissing(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42883' || error.code === '42P01' || /could not find|does not exist/i.test(error.message ?? '');
}

const EMPTY = (now: Date): SignupReport => buildSignupReport([], { now, weekly: null, excluded: new Set() });

export interface SignupReportLoad {
  status: LoadStatus;
  message: string | null;
  /** Weekly active could not be read: the week columns show nothing. */
  weeklyMissing: boolean;
  report: SignupReport;
}

export async function loadSignupReport(opts: { from: Date | null; to: Date | null; now?: Date }): Promise<SignupReportLoad> {
  const now = opts.now ?? new Date();
  if (!hasServiceRole()) return { status: 'no_service_role', message: null, weeklyMissing: true, report: EMPTY(now) };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('signup_source_facts', { p: { from: opts.from?.toISOString() ?? null, to: opts.to?.toISOString() ?? null } });
    if (error) return { status: schemaMissing(error) ? 'schema_missing' : 'failed', message: error.message, weeklyMissing: true, report: EMPTY(now) };
    const facts = (Array.isArray(data) ? data : []) as SignupFact[];

    // From the first sign-up shown, so "all time" only covers the weeks it needs.
    const first = facts.reduce<Date | null>((min, f) => {
      const d = new Date(f.created);
      return !min || d < min ? d : min;
    }, null);
    const weeks = weeksToCover(first ?? opts.from, now);
    let weekly: ActiveWeeks | null = null;
    // Batch 21 (E25): the "Exclude from metrics" switch is read on its own, so
    // it still applies when the weekly-active read fails.
    const manual = new Set<string>();
    const { data: ex, error: exErr } = await admin.from('activity_excluded_accounts').select('user_id');
    if (exErr) console.warn('[signups] excluded accounts not read:', exErr.message);
    for (const r of (ex ?? []) as { user_id: string }[]) manual.add(r.user_id);
    const { data: wf, error: wErr } = await admin.rpc('activity_weekly_facts', { p: { weeks, now: now.toISOString(), qualifying: QUALIFYING_KINDS, counted: COUNTED_KINDS } });
    if (!wErr && wf) {
      const report = computeWeeklyActive(wf as WeeklyFacts, { adminEmails: adminEmails(), drillWeeks: weeks });
      weekly = {
        weeks: new Set(report.weeks.map((w) => w.week)),
        active: new Map(report.members.map((m) => [m.id, new Set(m.weeks.filter((w) => w.active).map((w) => w.week))])),
      };
    } else if (wErr) {
      console.warn('[signups] weekly active not read:', wErr.message);
    }

    // The same exclusions as weekly active: admin, staff, and "Exclude".
    const admins = new Set(adminEmails().map(emailKey));
    const excluded = new Set(facts.filter((f) => manual.has(f.u) || exclusionFor(f.email, undefined, admins) !== null).map((f) => f.u));
    return { status: 'ok', message: null, weeklyMissing: weekly === null, report: buildSignupReport(facts, { now, weekly, excluded }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[signups] report failed:', message);
    return { status: 'failed', message, weeklyMissing: true, report: EMPTY(now) };
  }
}

export interface ConversionLine {
  at: string;
  event: string;
  valuePence: number | null;
  env: string;
  consented: boolean;
  server: string;
  serverHttp: number | null;
  serverNote: string | null;
  testEvent: boolean;
  browser: boolean;
}

export interface MetaStatusLoad {
  settings: ReturnType<typeof metaStatus>;
  status: LoadStatus;
  recent: ConversionLine[];
}

export async function loadMetaStatus(): Promise<MetaStatusLoad> {
  const settings = metaStatus();
  if (!hasServiceRole()) return { settings, status: 'no_service_role', recent: [] };
  try {
    const { data, error } = await createAdminClient()
      .from('meta_conversions')
      .select('created_at, event_name, value_pence, env, consented, server_status, server_http, server_note, test_event, browser_claimed_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return { settings, status: schemaMissing(error) ? 'schema_missing' : 'failed', recent: [] };
    type Row = { created_at: string; event_name: string; value_pence: number | null; env: string; consented: boolean; server_status: string; server_http: number | null; server_note: string | null; test_event: boolean; browser_claimed_at: string | null };
    return {
      settings,
      status: 'ok',
      recent: ((data ?? []) as Row[]).map((r) => ({
        at: r.created_at,
        event: r.event_name,
        valuePence: r.value_pence,
        env: r.env,
        consented: r.consented,
        server: r.server_status,
        serverHttp: r.server_http,
        serverNote: r.server_note,
        testEvent: r.test_event,
        browser: r.browser_claimed_at !== null,
      })),
    };
  } catch {
    return { settings, status: 'failed', recent: [] };
  }
}
