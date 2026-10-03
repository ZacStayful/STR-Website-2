import 'server-only';

/**
 * Batch 23b: the briefing pass (06:40 and 06:55 UTC, before the 07:00 picks
 * emails). Its own pass, never inside the picks passes: one model call per
 * member would not fit their 60 seconds as members grow.
 *
 * Per member, in order:
 *   1. Audience: daily picks on, signed in once, not paused or inactive, at
 *      least one running profile (the picks passes' own rules). Picks off: no
 *      briefing (their changes-only email is unchanged).
 *   2. £0 (the payer has nothing spendable): no briefing, no row. The email
 *      is exactly what it is today.
 *   3. Claim today's row (member_briefings, unique per member per UK day).
 *   4. The fact sheet (code), the angle (never yesterday's), the nudges.
 *   5. AI or template (./decide.ts). AI: reserve the ceiling, write, validate.
 *      Passed: charge the tokens under the reservation (once: the ledger is
 *      checked by action id first), store. Rejected, failed or late: the
 *      template opener and the email's own subject, nothing charged.
 *
 * Carry-on: members not reached inside the time budget have no row; the
 * 06:55 run takes them, and a row a dead run left 'generating' is reclaimed
 * after five minutes. A member whose row is not ready when their email is
 * built gets the template opener, uncharged (src/lib/briefing/email.ts).
 *
 * ?dry=1: everything up to the writer's reply and the validator, shown and
 * not stored or charged (the model call itself is house spend).
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBillingSettings, getUnitCostTable } from '../credit/unit-costs';
import { getBalance, InsufficientCreditError } from '../credit/ledger';
import { actionSpend, startAction } from '../credit/action';
import { approxTokens, meter } from '../credit/meter';
import { isAdminEmail } from '../admin';
import { isPaused } from '../access';
import { inactivePausedIds } from '../inactivity/server';
import { allProfilesFor } from '../profiles/server';
import { seatsFor } from '../profiles/rules';
import { payersForCharging } from '../listing/daily-deals-server';
import { dailyDealsMode } from '../listing/daily-deals';
import { mapLimit } from '../notify/daily-server';
import { PERSONA_VERSION } from '../persona/stayful-intelligence';
import { ANGLES, chooseAngle, templateOpener, type AngleId } from './angles';
import { buildFactSheet, factOf, type FactSheet } from './facts';
import { buildAiInput, briefingSystemPrompt, briefingUserMessage, nudgeForms } from './ai-input';
import { nudgeLinks, type NudgeLink } from './nudges';
import { allowedFor, validateBriefing, type Verdict } from './validator';
import { greetingLine } from './greeting';
import { BRIEFING_CEILING_PENCE, afterWriting, ceilingPence, dayChargeEstimate, decide, type Plan } from './decide';
import { BRIEFING_MAX_TOKENS, BRIEFING_MODEL, unitsFor, writeBriefing, writerConfigured, type WriterResult } from './writer';
import { shouldCharge } from './once';
import { claimBriefing, finishBriefing, recentAnglesFor, releaseClaim, saveProvisional, settledToday } from './store';
import { dayCounts, loadRunContext, loadSheet, type RunContext } from './sheet-server';

const PAGE = 1000;
const CONCURRENCY = 6;
/** Inside the route's 60 s, with room to finish the members already started (the writer times out at 15 s). */
const TIME_BUDGET_MS = 35_000;

export interface RunOptions {
  dry: boolean;
  onlyUserIds?: string[];
  now?: Date;
  /** The trial: write with this model instead (dry runs only). */
  model?: string;
}

export interface MemberOutcome {
  user: string;
  outcome: 'ai' | 'template' | 'none' | 'skipped' | 'held' | 'error';
  reason?: string;
  angle?: AngleId | null;
  greeting?: string;
  opener?: string;
  subject?: string | null;
  nudges?: string[];
  factsUsed?: string[];
  chargePence?: number;
  wouldChargePence?: number;
  ceilingPence?: number;
  inputTokens?: number;
  outputTokens?: number;
  rejected?: string | null;
}

export interface RunResult {
  status: number;
  body: Record<string, unknown>;
}

interface AudienceRow {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  subscription_paused_from: string | null;
  subscription_paused_until: string | null;
}

async function audience(admin: ReturnType<typeof createAdminClient>, only?: string[]): Promise<AudienceRow[]> {
  const out: AudienceRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin.from('profiles').select('id, email, full_name, created_at, subscription_paused_from, subscription_paused_until').eq('sourcing_alerts', true).not('welcome_checked_at', 'is', null);
    if (only) q = q.in('id', only);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`audience: ${error.message}`);
    out.push(...((data ?? []) as AudienceRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

export async function runBriefings(opts: RunOptions): Promise<RunResult> {
  if (!hasServiceRole()) return { status: 503, body: { error: 'No service role' } };
  const started = Date.now();
  const now = opts.now ?? new Date();
  const admin = createAdminClient();
  const [settings, table] = await Promise.all([getBillingSettings(), getUnitCostTable()]);
  const model = opts.dry && opts.model ? opts.model : BRIEFING_MODEL;
  const units = unitsFor(model);
  const inRow = units ? table.get(`anthropic:${units.input}`) : undefined;
  const outRow = units ? table.get(`anthropic:${units.output}`) : undefined;
  const writerReady = writerConfigured() && Boolean(inRow && outRow && inRow.unitCostPence > 0 && outRow.unitCostPence > 0);

  const ctx: RunContext = await loadRunContext(admin, now);
  const counts = await dayCounts(ctx);
  if (!opts.dry) {
    const { error } = await admin
      .from('briefing_day_counts')
      .upsert({ uk_day: ctx.ukDay, taken_at: now.toISOString(), screened_yesterday: counts.screenedYesterday, live_pool: counts.livePool, went_live_yesterday: counts.wentLiveYesterday }, { onConflict: 'uk_day', ignoreDuplicates: true });
    if (error) console.warn('[briefing] day counts not stored:', error.message);
  }

  const rows = await audience(admin, opts.onlyUserIds);
  const inactive = await inactivePausedIds(admin);
  const profileRows = await allProfilesFor(admin, rows.map((r) => r.id));
  const eligible = rows.filter((r) => r.email && !inactive.has(r.id) && !isPaused(r) && !seatsFor(r.id, profileRows?.get(r.id)).allPaused);
  const seats = new Map(eligible.map((r) => [r.id, seatsFor(r.id, profileRows?.get(r.id)).seats.length]));
  const settled = opts.dry ? new Set<string>() : await settledToday(admin, eligible.map((r) => r.id), ctx.ukDay, now);
  const todo = eligible.filter((r) => !settled.has(r.id));
  const payers = await payersForCharging(todo.map((r) => r.id));
  if (!payers) return { status: 503, body: { error: 'Team lookup failed; nothing written or charged' } };
  const recent = await recentAnglesFor(admin, todo.map((r) => r.id), ctx.ukDay);

  const mode = dailyDealsMode(settings.dealPricing, now);
  const ladderTop = Math.max(0, ...settings.dealOpenLadder.map((b) => b.pence));
  const pickUnit = table.get('pmi:daily_pick');
  const pickUnitPence = pickUnit ? pickUnit.unitCostPence * pickUnit.markup : 0;
  const balances = new Map<string, Promise<number | null>>();
  const balanceOf = (payerId: string) => {
    if (!balances.has(payerId)) balances.set(payerId, getBalance(payerId).then((b) => b.spendableBasePence).catch(() => null));
    return balances.get(payerId)!;
  };
  const held = new Map<string, number>();

  const results: MemberOutcome[] = [];
  const outOfTime: string[] = [];
  await mapLimit(todo, CONCURRENCY, async (m) => {
    if (Date.now() - started > TIME_BUDGET_MS) {
      outOfTime.push(m.id);
      return;
    }
    try {
      results.push(await briefMember(m));
    } catch (err) {
      console.error('[briefing] member failed:', m.id, (err as Error)?.message ?? err);
      results.push({ user: m.id, outcome: 'error', reason: String((err as Error)?.message ?? err).slice(0, 200) });
    }
  });

  async function briefMember(m: AudienceRow): Promise<MemberOutcome> {
    const adminUser = isAdminEmail(m.email);
    const payer = payers!.get(m.id) ?? { payerId: m.id, memberId: null, suspended: false };
    if (payer.suspended) return { user: m.id, outcome: 'none', reason: 'seat_paused' };
    const spendable = adminUser ? 0 : await balanceOf(payer.payerId);
    const dayCharge = adminUser ? 0 : dayChargeEstimate({ mode, seats: seats.get(m.id) ?? 1, dailyPence: settings.dealPricing.todays5DailyPence, ladderTopPence: ladderTop, pickUnitPence });
    // £0 first, before anything is claimed or read: their email stays exactly as it is.
    if (!adminUser && !((spendable ?? 0) - (held.get(payer.payerId) ?? 0) > 0)) return { user: m.id, outcome: 'none', reason: 'no_credit' };

    const claim = opts.dry ? { id: 'dry', actionId: 'dry' } : await claimBriefing(admin, m.id, ctx.ukDay, now);
    if (!claim) return { user: m.id, outcome: 'held', reason: 'another run has it' };
    try {
      const loaded = await loadSheet(ctx, { userId: m.id, joinedAt: m.created_at, adminUser });
      const sheet = buildFactSheet(loaded.inputs);
      const history = recent.get(m.id) ?? [null, null, null];
      const angle = chooseAngle(sheet, history);
      const greeting = greetingLine(ctx.ukDay, m.id, m.full_name, true);
      const links = nudgeLinks(loaded.overdue);
      if (!angle) {
        if (!opts.dry) await finishBriefing(admin, claim.id, finishedOf({ status: 'skipped', angle: null, greeting, opener: null, subject: null, nudges: [], sheet, plan: null, writer: null, verdict: null, charge: 0, rejectReason: 'no_new_angle' }), now);
        return { user: m.id, outcome: 'skipped', reason: 'no_new_angle' };
      }

      const input = buildAiInput(sheet, angle, history, loaded.overdue, links);
      const promptTokens = approxTokens(briefingSystemPrompt() + briefingUserMessage(input)) + 50;
      const ceiling = inRow && outRow ? ceilingPence({ inputTokens: promptTokens, maxOutputTokens: BRIEFING_MAX_TOKENS, inputUnitPence: inRow.unitCostPence, outputUnitPence: outRow.unitCostPence, inputMarkup: inRow.markup, outputMarkup: outRow.markup }) : 0;
      const plan: Plan = decide({ spendable, heldThisRun: held.get(payer.payerId) ?? 0, dayCharge, ceiling, enabled: settings.briefingsEnabled, writerReady, admin: adminUser });
      if (plan.kind === 'none') {
        if (!opts.dry) await releaseClaim(admin, claim.id);
        return { user: m.id, outcome: 'none', reason: plan.reason };
      }
      if (!adminUser) held.set(payer.payerId, (held.get(payer.payerId) ?? 0) + dayCharge + (plan.kind === 'ai' ? ceiling : 0));

      const template = templateOpener(sheet, angle);
      if (!opts.dry) await saveProvisional(admin, claim.id, { angle, greeting, opener: template, nudges: links });
      if (plan.kind === 'template') {
        if (!opts.dry) await finishBriefing(admin, claim.id, finishedOf({ status: 'template', angle, greeting, opener: template, subject: null, nudges: links, sheet, plan, writer: null, verdict: null, charge: 0, rejectReason: plan.reason }), now);
        return { user: m.id, outcome: 'template', reason: plan.reason, angle, greeting, opener: template, subject: null, nudges: links.map((l) => l.text), factsUsed: factsUsed(sheet, angle), ceilingPence: round(ceiling) };
      }

      // AI: reserve the ceiling (the payer's, for a team seat), write, validate, then charge.
      let action: Awaited<ReturnType<typeof startAction>> | null = null;
      if (!opts.dry) {
        try {
          action = await startAction({ userId: m.id, admin: adminUser, action: 'briefing', maxBasePence: ceiling, requireCredit: true, actionId: claim.actionId });
        } catch (err) {
          if (!(err instanceof InsufficientCreditError)) throw err;
          await finishBriefing(admin, claim.id, finishedOf({ status: 'template', angle, greeting, opener: template, subject: null, nudges: links, sheet, plan, writer: null, verdict: null, charge: 0, rejectReason: 'low_credit' }), now);
          return { user: m.id, outcome: 'template', reason: 'low_credit', angle, opener: template };
        }
      }
      try {
        const written = await writeBriefing(input, model);
        const allowed = allowedFor(sheet, nudgeForms(loaded.overdue, links), loaded.forbidden);
        const verdict: Verdict | null = written.output ? validateBriefing(written.output, allowed, links.length) : null;
        const after = afterWriting({ replied: Boolean(written.output), valid: Boolean(verdict?.ok), admin: adminUser });
        const ok = after.use === 'ai';
        const rejected = !written.output ? written.error : verdict && !verdict.ok ? `${verdict.reason}: ${verdict.detail}` : null;
        // The writer's nudge lines replace the template's one for one; the links stay code's.
        const nudges: NudgeLink[] = ok ? links.map((l, i) => ({ ...l, text: written.output!.nudges[i] ?? l.text })) : links;
        const wouldCharge = inRow && outRow && ok ? round(written.inputTokens * inRow.unitCostPence * inRow.markup + written.outputTokens * outRow.unitCostPence * outRow.markup) : 0;
        let charge = 0;
        if (after.charge && action) charge = await chargeOnce(action, written, units!);
        if (!opts.dry) {
          await finishBriefing(
            admin,
            claim.id,
            finishedOf({ status: ok ? 'ready' : 'template', angle, greeting, opener: ok ? written.output!.opener : template, subject: ok ? written.output!.subject : null, nudges, sheet, plan, writer: written, verdict, charge, rejectReason: rejected }),
            now,
          );
        }
        return {
          user: m.id,
          outcome: ok ? 'ai' : 'template',
          reason: ok ? undefined : 'rejected',
          rejected,
          angle,
          greeting,
          opener: ok ? written.output!.opener : template,
          subject: ok ? written.output!.subject : null,
          nudges: nudges.map((n) => n.text),
          factsUsed: factsUsed(sheet, angle),
          chargePence: charge,
          wouldChargePence: adminUser ? 0 : wouldCharge,
          ceilingPence: round(ceiling),
          inputTokens: written.inputTokens,
          outputTokens: written.outputTokens,
          ...(opts.dry && written.output && !ok ? { aiOpener: written.output.opener, aiSubject: written.output.subject } : {}),
        };
      } finally {
        await action?.finish().catch(() => {});
      }
    } catch (err) {
      // Nothing was charged on any path that throws before chargeOnce: give the claim back for the next run.
      if (!opts.dry) await releaseClaim(admin, claim.id).catch(() => {});
      throw err;
    }
  }

  const tally = (o: MemberOutcome['outcome']) => results.filter((r) => r.outcome === o).length;
  const summary = {
    dry: opts.dry,
    ukDay: ctx.ukDay,
    model,
    enabled: settings.briefingsEnabled,
    writerReady,
    counts,
    audience: rows.length,
    eligible: eligible.length,
    alreadyDone: settled.size,
    ai: tally('ai'),
    template: tally('template'),
    none: tally('none'),
    skipped: tally('skipped'),
    held: tally('held'),
    errors: tally('error'),
    outOfTime: outOfTime.length,
    charged: round(results.reduce((n, r) => n + (r.chargePence ?? 0), 0)),
    ms: Date.now() - started,
  };
  console.log('[briefing] run', JSON.stringify(summary));
  return { status: 200, body: { ...summary, ...(opts.dry ? { members: results } : {}) } };
}

/** Charge the tokens of a validated briefing, once: a charge already on the ledger under this action id is never repeated. */
async function chargeOnce(action: Awaited<ReturnType<typeof startAction>>, written: WriterResult, units: { input: string; output: string }): Promise<number> {
  const actionId = action.ctx.actionId!;
  const before = await actionSpend(actionId);
  if (!shouldCharge(before.basePence)) return before.basePence;
  await meter({ provider: 'anthropic', unit: units.output, quantity: written.outputTokens, skipPreflight: true, description: 'Daily briefing (output tokens)' }, async () => null, action.ctx);
  await meter({ provider: 'anthropic', unit: units.input, quantity: written.inputTokens, skipPreflight: true, description: 'Daily briefing (input tokens)' }, async () => null, action.ctx);
  return (await actionSpend(actionId)).basePence;
}

function factsUsed(sheet: FactSheet, angle: AngleId): string[] {
  return ANGLES[angle].facts.filter((id) => factOf(sheet, id) !== null);
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function finishedOf(p: {
  status: 'ready' | 'template' | 'skipped';
  angle: AngleId | null;
  greeting: string;
  opener: string | null;
  subject: string | null;
  nudges: NudgeLink[];
  sheet: FactSheet;
  plan: Plan | null;
  writer: WriterResult | null;
  verdict: Verdict | null;
  charge: number;
  rejectReason: string | null;
}) {
  return {
    status: p.status,
    angle: p.angle,
    greeting: p.greeting,
    opener: p.opener,
    subject: p.subject,
    nudges: p.nudges,
    facts: { facts: p.sheet.facts, inputs: p.sheet.inputs, comparisons: p.sheet.comparisons },
    factsUsed: p.angle ? factsUsed(p.sheet, p.angle) : [],
    personaVersion: PERSONA_VERSION,
    model: p.writer?.model ?? null,
    aiAttempted: Boolean(p.writer),
    rejectReason: p.rejectReason,
    inputTokens: p.writer?.inputTokens ?? 0,
    outputTokens: p.writer?.outputTokens ?? 0,
    chargePence: p.charge,
  };
}

export { BRIEFING_CEILING_PENCE };
