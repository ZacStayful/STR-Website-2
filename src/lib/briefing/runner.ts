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
import { randomUUID } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBillingSettings, getUnitCostTable } from '../credit/unit-costs';
import { getBalance, InsufficientCreditError } from '../credit/ledger';
import { actionSpend, startAction } from '../credit/action';
import { approxTokens, meter } from '../credit/meter';
import type { MeterContext } from '../credit/context';
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
import { afterWriting, cappedTokens, ceilingPence, dayChargeEstimate, decide, type Plan } from './decide';
import { BRIEFING_MAX_TOKENS, BRIEFING_MODEL, WRITER_TIMEOUT_MS, unitsFor, writeBriefing, writerConfigured, type WriterResult } from './writer';
import { shouldCharge } from './once';
import { claimBriefing, finishBriefing, recentAnglesFor, releaseClaim, saveProvisional, schemaMissing, settledToday, type Finished } from './store';
import { dayCounts, loadRunContext, loadSheet, type RunContext } from './sheet-server';

const PAGE = 1000;
const CONCURRENCY = 6;
/** The route's maxDuration (src/app/api/internal/briefings/route.ts). */
const ROUTE_MS = 60_000;
/**
 * R3 (sweep): no member starts with less than ~35 s of the route left, and the writer's timeout is bounded by
 * what is left, so a member's sheet, writer and charge always fit and a kill can only land before any charge.
 */
const TIME_BUDGET_MS = 25_000;

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
  // R3-11: the Batch 23b tables missing is a deploy step, not a crash: a 200 that says so, and nothing else runs.
  const probe = await admin.from('member_briefings').select('id').limit(1);
  if (probe.error && schemaMissing(probe.error.message)) {
    console.warn('[briefing] member_briefings is not on this database; run the Batch 23b section of supabase/schema.sql');
    return { status: 200, body: { dry: opts.dry, schemaMissing: true, error: 'member_briefings is not on this database: run the "Batch 23b: the morning briefing" section of supabase/schema.sql, then check ?dry=1 again' } };
  }
  const [settings, table] = await Promise.all([getBillingSettings(), getUnitCostTable()]);
  const model = opts.dry && opts.model ? opts.model : BRIEFING_MODEL;
  const units = unitsFor(model);
  const inRow = units ? table.get(`anthropic:${units.input}`) : undefined;
  const outRow = units ? table.get(`anthropic:${units.output}`) : undefined;
  const writerReady = writerConfigured() && Boolean(inRow && outRow && inRow.unitCostPence > 0 && outRow.unitCostPence > 0);
  // R3: the most any briefing may be charged (billing_settings.briefing_ceiling_pence), and the token prices the charge uses.
  const ceilingMax = settings.briefingCeilingPence;
  const rates = inRow && outRow ? { inputPence: inRow.unitCostPence * inRow.markup, outputPence: outRow.unitCostPence * outRow.markup } : null;

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
    // R3 (sweep): the day's charge and the most a briefing may cost are set aside NOW, before any await, so a
    // teammate briefed in the same wave never assumes the same balance; trued up once the plan is known.
    const provisional = adminUser ? 0 : dayCharge + ceilingMax;
    let myHold = 0;
    /** What this member holds from the payer's balance right now: a member with credit always holds the day's charge, and the ceiling only while the writer runs. */
    const holdNow = (pence: number) => {
      if (adminUser || pence === myHold) return;
      held.set(payer.payerId, (held.get(payer.payerId) ?? 0) + pence - myHold);
      myHold = pence;
    };
    holdNow(provisional);

    const claim = opts.dry ? { id: 'dry', actionId: 'dry', reclaimed: false } : await claimBriefing(admin, m.id, ctx.ukDay, now);
    if (!claim) {
      holdNow(dayCharge);
      return { user: m.id, outcome: 'held', reason: 'another run has it' };
    }
    // R3-16 (and the reclaim findings): a row a dead run left after charging. That charge stands, is never
    // repeated and is what the row records; nothing is reserved again, and the row is never deleted.
    const paid = !opts.dry && claim.reclaimed ? (await actionSpend(claim.actionId).catch(() => ({ basePence: 0 }))).basePence : 0;
    let charged = paid > 0;
    const finish = (f: Finished) => finishBriefing(admin, claim.id, f, now).catch(() => finishBriefing(admin, claim.id, f, now));
    try {
      const loaded = await loadSheet(ctx, { userId: m.id, joinedAt: m.created_at, adminUser });
      const sheet = buildFactSheet(loaded.inputs);
      const history = recent.get(m.id) ?? [null, null, null];
      const angle = chooseAngle(sheet, history);
      const greeting = greetingLine(ctx.ukDay, m.id, m.full_name, true);
      const links = nudgeLinks(loaded.overdue);
      if (!angle) {
        holdNow(dayCharge);
        if (!opts.dry) await finish(finishedOf({ status: 'skipped', angle: null, greeting, opener: null, subject: null, nudges: [], sheet, plan: null, writer: null, verdict: null, charge: paid, rejectReason: 'no_new_angle' }));
        return { user: m.id, outcome: 'skipped', reason: 'no_new_angle', chargePence: paid };
      }

      const input = buildAiInput(sheet, angle, history, loaded.overdue, links);
      const promptTokens = approxTokens(briefingSystemPrompt() + briefingUserMessage(input)) + 50;
      const ceiling = inRow && outRow ? ceilingPence({ inputTokens: promptTokens, maxOutputTokens: BRIEFING_MAX_TOKENS, inputUnitPence: inRow.unitCostPence, outputUnitPence: outRow.unitCostPence, inputMarkup: inRow.markup, outputMarkup: outRow.markup }) : 0;
      const plan: Plan =
        paid > 0
          ? settings.briefingsEnabled && writerReady
            ? { kind: 'ai' }
            : { kind: 'template', reason: settings.briefingsEnabled ? 'no_writer' : 'switched_off' }
          : decide({ spendable, heldThisRun: (held.get(payer.payerId) ?? 0) - provisional, dayCharge, ceiling, ceilingMax, enabled: settings.briefingsEnabled, writerReady, admin: adminUser });
      if (plan.kind === 'none') {
        holdNow(0);
        if (!opts.dry && !claim.reclaimed) await releaseClaim(admin, claim.id);
        return { user: m.id, outcome: 'none', reason: plan.reason };
      }
      // The hold becomes what this member really takes: the day's charge, plus the ceiling while an AI briefing is written.
      holdNow(dayCharge + (plan.kind === 'ai' && paid === 0 ? ceiling : 0));

      const template = templateOpener(sheet, angle);
      if (!opts.dry) await saveProvisional(admin, claim.id, { angle, greeting, opener: template, nudges: links });
      if (plan.kind === 'template') {
        if (!opts.dry) await finish(finishedOf({ status: 'template', angle, greeting, opener: template, subject: null, nudges: links, sheet, plan, writer: null, verdict: null, charge: paid, rejectReason: plan.reason }));
        return { user: m.id, outcome: 'template', reason: plan.reason, angle, greeting, opener: template, subject: null, nudges: links.map((l) => l.text), factsUsed: factsUsed(sheet, angle), chargePence: paid, ceilingPence: round(ceiling) };
      }

      // AI: reserve the ceiling (the payer's, for a team seat), write, validate, then charge.
      let action: Awaited<ReturnType<typeof startAction>> | null = null;
      if (!opts.dry && paid === 0) {
        try {
          action = await startAction({ userId: m.id, admin: adminUser, action: 'briefing', maxBasePence: ceiling, requireCredit: true, actionId: claim.actionId });
        } catch (err) {
          if (!(err instanceof InsufficientCreditError)) throw err;
          holdNow(dayCharge);
          await finish(finishedOf({ status: 'template', angle, greeting, opener: template, subject: null, nudges: links, sheet, plan, writer: null, verdict: null, charge: paid, rejectReason: 'low_credit' }));
          return { user: m.id, outcome: 'template', reason: 'low_credit', angle, opener: template };
        }
      }
      try {
        // R3 (sweep): the writer never runs past what is left of the route, so a kill cannot land on the charge path.
        const written = await writeBriefing(input, model, { timeoutMs: Math.min(WRITER_TIMEOUT_MS, ROUTE_MS - 5_000 - (Date.now() - started)) });
        const allowed = allowedFor(sheet, nudgeForms(loaded.overdue, links), loaded.forbidden);
        const verdict: Verdict | null = written.output ? validateBriefing(written.output, allowed, links.length) : null;
        const after = afterWriting({ replied: Boolean(written.output), valid: Boolean(verdict?.ok), admin: adminUser });
        const ok = after.use === 'ai';
        const rejected = !written.output ? written.error : verdict && !verdict.ok ? `${verdict.reason}: ${verdict.detail}` : null;
        // The writer's nudge lines replace the template's one for one; the links stay code's.
        const nudges: NudgeLink[] = ok ? links.map((l, i) => ({ ...l, text: written.output!.nudges[i] ?? l.text })) : links;
        const wouldCharge = inRow && outRow && ok ? round(written.inputTokens * inRow.unitCostPence * inRow.markup + written.outputTokens * outRow.unitCostPence * outRow.markup) : 0;
        let charge = paid;
        if (paid === 0 && after.charge && action) {
          // From here a crash must not give the claim back: the ledger may hold the debit (R3-16).
          charged = true;
          charge = await chargeOnce(action, written, units!, rates ? { ...rates, capPence: ceiling } : null);
        } else if (units && (written.inputTokens > 0 || written.outputTokens > 0 || written.error)) {
          // R3 (sweep): a rejected, failed, dry-run or already-paid call is still a model call: house spend, logged at £0.
          await logHouseCall(written, units, opts.dry ? randomUUID() : claim.actionId);
        }
        // The ceiling was the hold; the real charge is what the payer's balance has lost.
        holdNow(dayCharge + charge);
        if (!opts.dry) {
          await finish(finishedOf({ status: ok ? 'ready' : 'template', angle, greeting, opener: ok ? written.output!.opener : template, subject: ok ? written.output!.subject : null, nudges, sheet, plan, writer: written, verdict, charge, rejectReason: rejected }));
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
      // The claim goes back only when nothing can be on the ledger under it (R3-16): after a charge, or on a
      // reclaimed row, it stays 'generating' so the next run reclaims it with its action id and finds the debit.
      if (!charged) holdNow(dayCharge);
      if (!opts.dry && !charged && !claim.reclaimed) await releaseClaim(admin, claim.id).catch(() => {});
      throw err;
    }
  }

  const tally = (o: MemberOutcome['outcome']) => results.filter((r) => r.outcome === o).length;
  const summary = {
    dry: opts.dry,
    ukDay: ctx.ukDay,
    model,
    enabled: settings.briefingsEnabled,
    ceilingMaxPence: ceilingMax,
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
async function chargeOnce(action: Awaited<ReturnType<typeof startAction>>, written: WriterResult, units: { input: string; output: string }, cap: { inputPence: number; outputPence: number; capPence: number } | null): Promise<number> {
  const actionId = action.ctx.actionId!;
  const before = await actionSpend(actionId);
  if (!shouldCharge(before.basePence)) return before.basePence;
  // R3 (sweep): the real tokens, but never past the ceiling the member was quoted; the dearer part (output) lands first.
  const q = cap ? cappedTokens({ inputTokens: written.inputTokens, outputTokens: written.outputTokens, ...cap }) : { inputTokens: written.inputTokens, outputTokens: written.outputTokens, scaled: false };
  if (q.scaled) console.warn('[briefing] charge capped at the ceiling', JSON.stringify({ actionId, inputTokens: written.inputTokens, outputTokens: written.outputTokens, capPence: cap?.capPence }));
  await meter({ provider: 'anthropic', unit: units.output, quantity: q.outputTokens, skipPreflight: true, description: 'Daily briefing (output tokens)' }, async () => null, action.ctx);
  await meter({ provider: 'anthropic', unit: units.input, quantity: q.inputTokens, skipPreflight: true, description: 'Daily briefing (input tokens)' }, async () => null, action.ctx);
  return (await actionSpend(actionId)).basePence;
}

/** R3 (sweep): a model call not charged to the member (rejected, failed, a dry run, a reclaim already paid): house spend, logged at £0 so the spend views see it. */
async function logHouseCall(written: WriterResult, units: { input: string; output: string }, actionId: string): Promise<void> {
  const house: MeterContext = { userId: null, admin: false, action: 'briefing', actionId };
  try {
    if (written.outputTokens > 0) await meter({ provider: 'anthropic', unit: units.output, quantity: written.outputTokens, skipPreflight: true, description: 'Daily briefing (output tokens, not charged)' }, async () => null, house);
    if (written.inputTokens > 0) await meter({ provider: 'anthropic', unit: units.input, quantity: written.inputTokens, skipPreflight: true, description: 'Daily briefing (input tokens, not charged)' }, async () => null, house);
    if (written.error && written.inputTokens === 0 && written.outputTokens === 0) await meter({ provider: 'anthropic', unit: units.input, quantity: 0, skipPreflight: true, description: `Daily briefing (${written.error.slice(0, 60)})`, failed: () => true }, async () => null, house);
  } catch (err) {
    console.warn('[briefing] house call not logged:', (err as Error)?.message ?? err);
  }
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
