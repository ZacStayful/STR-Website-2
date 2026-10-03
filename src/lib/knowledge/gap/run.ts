import 'server-only';

/**
 * Batch 24: the nightly gap job (/api/internal/si-knowledge, 02:50 UTC).
 *
 *   1. claim the UK day in si_gap_runs (never twice; a dry run claims nothing)
 *   2. mark stale entries; re-sync the phone agent if it is behind
 *   3. the Monday email about last week (claimed once a week, so a missed
 *      Monday is sent the next night; a dry run previews it on Mondays), and
 *      question retention: questions older than si_question_retention_months
 *      are deleted (a dry run counts them)
 *   4. read the questions Stayful Intelligence couldn't answer (low
 *      confidence, could not answer, member unhappy) that no run has grouped
 *      yet, oldest first, at most si_gap_max_questions
 *   5. group them (Haiku 4.5), GAP_GROUP_BATCH at a time: each group
 *      continues an open gap, matches an approved or rejected answer, or is new
 *   6. draft one answer per open gap without one (Sonnet 5.5), most asked
 *      first, at most si_gap_max_groups_per_night
 * No model call starts after GAP_TIME_BUDGET_MS; what is left waits for the
 * next night.
 *
 * Every model call is house spend (never a member's credit), checked against
 * si_gap_monthly_cap_pence before it is made (its worst case) and recorded on
 * the run after (what it did cost). `dry` makes the model calls, so it can
 * show the groups and drafts it would make, but writes nothing except the
 * dry run's own cost row (the cap must count it). `estimate` makes no model
 * call at all.
 */
import { createAdminClient } from '../../supabase/admin';
import { getUnitCostTable } from '../../credit/unit-costs';
import { unitKey } from '../../credit/costs';
import { newActionId, type MeterContext } from '../../credit/context';
import { londonMonthStart } from '../../sms/uk-time';
import { londonDayStart } from '../../leads/search';
import { ukDay, ukWeekday } from '../../voice/hours';
import { voiceConfig } from '../../voice/config';
import { GAP_ACTION, GAP_DRAFT_MAX_TOKENS, GAP_DRAFT_MODEL, GAP_GROUP_BATCH, GAP_GROUP_MAX_TOKENS, GAP_GROUP_MODEL, GAP_OUTCOMES, GAP_REQUEST_OVERHEAD_TOKENS, GAP_SAMPLES_MAX, GAP_TIME_BUDGET_MS, RUN_STALE_CLAIM_MS } from '../config';
import { checkContent, type EntryContent } from '../render';
import { entryStatus, type KnowledgeRow } from '../rows';
import { SERVICE_FACTS } from '../service-facts';
import { agentKnowledgeState, syncAgentKnowledge } from '../agent-server';
import { allEntries, checkStale, createEntry, liveEntries, readGlobalSnapshot, readKnowledgeSettings, type Admin } from '../store-server';
import { runWeeklyGapEmail, type WeeklyResult } from '../weekly-server';
import { callModel, modelsConfigured } from './models-server';
import { catalogueForDrafting, draftCandidates, estimateTokens, fitsCap, knowledgeForDrafting, MAX_DRAFT_ATTEMPTS, MODEL_UNITS, uniqueSlug, worstCasePence, type GapRow } from './plan';
import { draftMessages, DRAFT_SCHEMA, groupingMessage, GROUPING_SCHEMA, GROUPING_SYSTEM, parseDraft, parseGrouping, redactQuestion, type ParsedGroup } from './prompts';

export function gapJobEnabled(): boolean {
  return process.env.SI_GAP_JOB_ENABLED === 'true';
}

export interface GapRunOptions {
  dry: boolean;
  /** No model calls at all: what would be read and what it could cost. */
  estimate: boolean;
  triggeredBy: string;
  now?: Date;
}

interface QuestionRow {
  id: string;
  question: string;
  outcome: string;
  source: string;
  at: string;
  conversation_id: string;
  channel: string;
}

const GAP_COLUMNS = 'id, label, status, entry_id, match_kind, asked, asked_since_decision, channels, outcomes, draft_attempts, last_error, uncovered, first_asked_at, last_asked_at';

interface FullGapRow extends GapRow {
  match_kind: string | null;
  asked_since_decision: number;
  channels: Record<string, number>;
  outcomes: Record<string, number>;
  last_error: string | null;
  uncovered: boolean;
  first_asked_at: string | null;
}

/** The UK month's first instant. */
function monthStartIso(now: Date): string {
  return (londonDayStart(londonMonthStart(now)) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))).toISOString();
}

/** Model spend this UK month (every run, dry ones included), raw pence. */
export async function monthSpendPence(admin: Admin, now: Date): Promise<number | null> {
  const { data, error } = await admin.from('si_gap_runs').select('cost_pence').gte('claimed_at', monthStartIso(now));
  if (error) return null;
  return ((data ?? []) as { cost_pence: number | string }[]).reduce((n, r) => n + (Number(r.cost_pence) || 0), 0);
}

/**
 * The questions no run has looked at yet, oldest first (si_gap_new_questions:
 * grouped ones are excluded in the database, before the limit). A "member
 * unhappy" row from the post-call analysis carries the caller's last line;
 * the question asked just before it in the same conversation is the one to
 * learn from.
 */
async function newQuestions(admin: Admin, limit: number): Promise<QuestionRow[] | null> {
  const { data, error } = await admin.rpc('si_gap_new_questions', { p: { outcomes: [...GAP_OUTCOMES], limit } });
  if (error) {
    console.error('[knowledge] new questions read failed:', error.message);
    return null;
  }
  const rows = (Array.isArray(data) ? data : []) as { id?: unknown; question?: unknown; outcome?: unknown; source?: unknown; at?: unknown; conversation_id?: unknown; channel?: unknown; prior?: unknown }[];
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const out: QuestionRow[] = [];
  for (const r of rows) {
    const id = str(r.id);
    const question = str(r.prior) ?? str(r.question);
    const outcome = str(r.outcome);
    const at = str(r.at);
    const conversationId = str(r.conversation_id);
    if (!id || !question || !outcome || !at || !conversationId) continue;
    out.push({ id, question, outcome, source: str(r.source) ?? 'tool', at, conversation_id: conversationId, channel: str(r.channel) ?? 'call' });
  }
  return out;
}

const bump = (m: Record<string, number>, k: string, n = 1) => ({ ...m, [k]: (m[k] ?? 0) + n });

/** Write one group: link its questions (each once), then add them to the gap's counts. */
async function applyGroup(admin: Admin, g: ParsedGroup, qs: Map<string, QuestionRow>, entries: Map<string, KnowledgeRow>, gaps: Map<string, FullGapRow>): Promise<{ gapId: string; added: number } | null> {
  const entry = g.entrySlug ? entries.get(g.entrySlug) ?? null : null;
  const entryState = entry ? entryStatus(entry) : null;
  // A group continues its gap, or the gap already linked to the entry it matched, or starts a new one.
  let gap = g.gapId ? gaps.get(g.gapId) ?? null : null;
  if (!gap && entry) gap = [...gaps.values()].find((x) => x.entry_id === entry.id) ?? null;
  const now = new Date().toISOString();
  if (!gap) {
    const status = entryState === 'approved' ? 'covered' : entryState === 'rejected' ? 'rejected' : entry ? 'drafted' : 'open';
    const matchKind = entryState === 'approved' ? 'approved' : entryState === 'rejected' ? 'rejected' : entry ? 'draft' : null;
    const { data, error } = await admin.from('si_knowledge_gaps').insert({ label: g.label, status, entry_id: entry?.id ?? null, match_kind: matchKind }).select(GAP_COLUMNS).single();
    if (error || !data) {
      console.error('[knowledge] gap insert failed:', error?.message);
      return null;
    }
    gap = data as unknown as FullGapRow;
    gaps.set(gap.id, gap);
  }
  const { data: linked, error } = await admin
    .from('si_knowledge_gap_questions')
    .upsert(g.questionIds.map((id) => ({ question_id: id, gap_id: gap!.id })), { onConflict: 'question_id', ignoreDuplicates: true })
    .select('question_id');
  if (error) {
    console.error('[knowledge] gap link failed:', error.message);
    return null;
  }
  const added = ((linked ?? []) as { question_id: string }[]).map((r) => qs.get(r.question_id)).filter((q): q is QuestionRow => Boolean(q));
  if (added.length === 0) return { gapId: gap.id, added: 0 };
  let channels = gap.channels ?? {};
  let outcomes = gap.outcomes ?? {};
  for (const q of added) {
    channels = bump(channels, q.channel);
    outcomes = bump(outcomes, q.outcome);
  }
  const times = added.map((q) => q.at).sort();
  const decided = gap.status === 'rejected' || gap.status === 'covered';
  const patch = {
    asked: gap.asked + added.length,
    asked_since_decision: (gap.asked_since_decision ?? 0) + (decided ? added.length : 0),
    channels,
    outcomes,
    first_asked_at: gap.first_asked_at && gap.first_asked_at < times[0] ? gap.first_asked_at : times[0],
    last_asked_at: gap.last_asked_at && gap.last_asked_at > times[times.length - 1] ? gap.last_asked_at : times[times.length - 1],
    updated_at: now,
  };
  await admin.from('si_knowledge_gaps').update(patch).eq('id', gap.id);
  Object.assign(gap, patch);
  return { gapId: gap.id, added: added.length };
}

/** A gap's phrasings, as asked (newest first), for the drafting model and the entry's variants. */
async function samplesFor(admin: Admin, gapId: string): Promise<string[]> {
  const { data } = await admin.from('si_knowledge_gap_questions').select('si_conversation_questions(question, at)').eq('gap_id', gapId).limit(50);
  const qs = ((data ?? []) as unknown as { si_conversation_questions: { question: string; at: string } | { question: string; at: string }[] | null }[])
    .map((r) => (Array.isArray(r.si_conversation_questions) ? r.si_conversation_questions[0] : r.si_conversation_questions))
    .filter((q): q is { question: string; at: string } => Boolean(q))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((q) => q.question);
  return [...new Set(qs)].slice(0, GAP_SAMPLES_MAX);
}

export interface GapRunReport {
  dry: boolean;
  estimate: boolean;
  day: string;
  stale: { checked: number; newlyStale: string[] } | null;
  agent: string | null;
  monthSpentPence: number | null;
  capPence: number;
  questions: { read: number; sample: { id: string; channel: string; outcome: string; text: string }[] };
  grouping: { groups: { label: string; questions: number; continues: string | null; matches: string | null }[]; ungrouped: number; error: string | null } | null;
  drafts: { gap: string; slug: string | null; covered: boolean; answer: string | null; missing: string | null; checks: string[]; error: string | null }[];
  stopped: 'cap' | 'time' | 'max' | 'no_api_key' | null;
  weekly: WeeklyResult | null;
  retention: RetentionResult | null;
  costPence: number;
  worstCasePence: number;
  ms: number;
}

export type RetentionResult = { before: string; questions: number; gaps: number; more: boolean; dry: boolean } | { error: string };

/** Members' questions older than the retention setting (never under 12 months: the database refuses). */
async function questionRetention(admin: Admin, now: Date, months: number, dry: boolean): Promise<RetentionResult> {
  const before = new Date(now);
  before.setUTCMonth(before.getUTCMonth() - months);
  const { data, error } = await admin.rpc('si_question_retention', { p: { before: before.toISOString(), apply: !dry } });
  if (error) return { error: error.message };
  const r = data as { questions?: number; gaps?: number; more?: boolean };
  return { before: before.toISOString(), questions: Number(r.questions) || 0, gaps: Number(r.gaps) || 0, more: Boolean(r.more), dry };
}

/** One run of the nightly job. Returns the route's status and body. */
export async function runGapJob(o: GapRunOptions): Promise<{ status: number; body: GapRunReport | Record<string, unknown> }> {
  const admin = createAdminClient();
  const now = o.now ?? new Date();
  const started = Date.now();
  const day = ukDay(now);
  const actionId = newActionId();
  const ctx: MeterContext = { userId: null, admin: false, action: GAP_ACTION, actionId };

  // 1. The once-a-night claim (a dry run takes none, and writes only its own cost row).
  let runId: string | null = null;
  // What a failed earlier attempt today already spent: the run row keeps it, so the cap still counts it.
  let baseCost = 0;
  if (!o.dry) {
    const { data, error } = await admin.rpc('si_gap_claim', { p: { kind: 'nightly', run_key: day, stale_ms: RUN_STALE_CLAIM_MS } });
    if (error) return { status: 500, body: { error: error.message, hint: 'Run the Batch 24 section of supabase/schema.sql.' } };
    const claim = data as { id: string | null; cost_pence?: number | string };
    runId = claim.id;
    if (!runId) return { status: 200, body: { skipped: 'already ran today', day } };
    baseCost = Number(claim.cost_pence) || 0;
  }
  const report: GapRunReport = { dry: o.dry, estimate: o.estimate, day, stale: null, agent: null, monthSpentPence: null, capPence: 0, questions: { read: 0, sample: [] }, grouping: null, drafts: [], stopped: null, weekly: null, retention: null, costPence: 0, worstCasePence: 0, ms: 0 };
  let dryRowId: string | null = null;
  const recordCost = async (pence: number) => {
    report.costPence += pence;
    if (pence <= 0) return;
    if (runId) {
      await admin.from('si_gap_runs').update({ cost_pence: baseCost + report.costPence }).eq('id', runId);
    } else {
      if (!dryRowId) {
        const { data } = await admin.from('si_gap_runs').insert({ kind: 'dry', run_key: day, status: 'done', finished_at: new Date().toISOString(), cost_pence: report.costPence, report: { triggeredBy: o.triggeredBy } }).select('id').single();
        dryRowId = (data as { id: string } | null)?.id ?? null;
      } else await admin.from('si_gap_runs').update({ cost_pence: report.costPence }).eq('id', dryRowId);
    }
  };

  try {
    // 2. Stale entries, and the agent if it is behind.
    const stale = await checkStale({ dry: o.dry, actor: 'nightly job' }, admin);
    report.stale = stale ? { checked: stale.checked, newlyStale: stale.newlyStale.map((s) => s.slug) } : null;
    if (voiceConfig()) {
      const state = await agentKnowledgeState(admin);
      if (state.inStep) report.agent = 'in step';
      else if (o.dry) report.agent = 'behind: would re-sync';
      else report.agent = (await syncAgentKnowledge({ dry: false, toolsToo: false, reason: 'nightly' })).message;
    }

    const settings = await readKnowledgeSettings(admin);
    report.capPence = settings.gapMonthlyCapPence;

    // 3. The Monday email (once a week by its own claim, so a missed Monday goes the next night; a dry run previews it on Mondays only),
    //    and retention. Both before the model calls, so a run cut short by the time limit still does them.
    if (!o.dry || ukWeekday(now) === 1) report.weekly = await runWeeklyGapEmail({ dry: o.dry, now, triggeredBy: o.triggeredBy }, admin);
    report.retention = await questionRetention(admin, now, settings.questionRetentionMonths, o.dry);

    // 4. The questions no run has grouped yet.
    report.monthSpentPence = await monthSpendPence(admin, now);
    const questions = await newQuestions(admin, settings.gapMaxQuestions);
    if (!questions) throw new Error("the conversation log can't be read");
    report.questions = { read: questions.length, sample: questions.slice(0, 20).map((q) => ({ id: q.id, channel: q.channel, outcome: q.outcome, text: redactQuestion(q.question) })) };

    const table = await getUnitCostTable();
    const price = (unit: string) => table.get(unitKey('anthropic', unit))?.unitCostPence ?? 0;
    // This month's spend, read again before every call (another run's spend counts too), and never less than
    // what this run knows it has added; unreadable = no room (fail closed).
    const startSpent = report.monthSpentPence;
    const spent = async (): Promise<number> => {
      const fresh = await monthSpendPence(admin, now);
      if (fresh === null || startSpent === null) return Number.POSITIVE_INFINITY;
      return Math.max(fresh, startSpent + report.costPence);
    };
    const elapsed = () => Date.now() - started;

    const [rows, live, g] = await Promise.all([allEntries(admin), liveEntries(undefined, admin), readGlobalSnapshot(admin)]);
    if (!rows || !live || !g) throw new Error("the knowledge base or the settings can't be read");
    const entriesBySlug = new Map(rows.map((r) => [r.slug, r]));
    const { data: gapData, error: gapErr } = await admin.from('si_knowledge_gaps').select(GAP_COLUMNS).in('status', ['open', 'drafted', 'covered', 'rejected']).order('asked', { ascending: false }).limit(500);
    if (gapErr) throw new Error(gapErr.message);
    const gaps = new Map(((gapData ?? []) as unknown as FullGapRow[]).map((x) => [x.id, x]));

    // 5. Group (Haiku), a batch at a time. A batch that fails is left ungrouped and read again the next night.
    const qById = new Map(questions.map((q) => [q.id, q]));
    const newGroups: ParsedGroup[] = [];
    if (questions.length > 0) {
      const known = rows.filter((r) => ['approved', 'rejected'].includes(entryStatus(r))).map((r) => ({ slug: r.slug, question: r.question ?? (r.draft as { question?: string } | null)?.question ?? r.slug, status: entryStatus(r) as 'approved' | 'rejected' }));
      const slugs = new Set(known.map((k) => k.slug));
      const grouping: NonNullable<GapRunReport['grouping']> = { groups: [], ungrouped: 0, error: null };
      report.grouping = grouping;
      for (let i = 0; i < questions.length; i += GAP_GROUP_BATCH) {
        const batch = questions.slice(i, i + GAP_GROUP_BATCH);
        // Open gaps as they stand now: a gap a batch above created is offered to the next.
        const openGaps = [...gaps.values()].filter((x) => x.status === 'open' || x.status === 'drafted').map((x) => ({ id: x.id, label: x.label }));
        const msg = groupingMessage({ questions: batch.map((q) => ({ id: q.id, text: q.question, channel: q.channel })), gaps: openGaps, entries: known });
        const worst = worstCasePence(MODEL_UNITS[GAP_GROUP_MODEL], estimateTokens(GROUPING_SYSTEM + msg.text + JSON.stringify(GROUPING_SCHEMA)) + GAP_REQUEST_OVERHEAD_TOKENS, GAP_GROUP_MAX_TOKENS, price);
        report.worstCasePence += worst;
        if (o.estimate) {
          grouping.ungrouped += batch.length;
          grouping.error = 'estimate only: no model call';
          continue;
        }
        if (!modelsConfigured()) {
          report.stopped = 'no_api_key';
          break;
        }
        if (elapsed() > GAP_TIME_BUDGET_MS) {
          report.stopped = 'time';
          break;
        }
        if (!fitsCap(await spent(), worst, settings.gapMonthlyCapPence)) {
          report.stopped = 'cap';
          break;
        }
        const reply = await callModel({ model: GAP_GROUP_MODEL, system: GROUPING_SYSTEM, cacheSystem: false, user: msg.text, schema: GROUPING_SCHEMA as unknown as Record<string, unknown>, maxTokens: GAP_GROUP_MAX_TOKENS, ctx, label: 'grouping', price });
        await recordCost(reply.costPence);
        const parsed = reply.text && !reply.error ? parseGrouping(reply.text, msg, slugs) : null;
        if (!parsed) {
          grouping.ungrouped += batch.length;
          grouping.error ??= reply.error ?? 'the reply was not the JSON asked for';
          continue;
        }
        grouping.groups.push(...parsed.groups.map((x) => ({ label: x.label, questions: x.questionIds.length, continues: x.gapId, matches: x.entrySlug })));
        grouping.ungrouped += parsed.ungrouped.length;
        if (!o.dry) {
          for (const grp of parsed.groups) await applyGroup(admin, grp, qById, entriesBySlug, gaps);
          if (parsed.ungrouped.length) await admin.from('si_knowledge_gap_questions').upsert(parsed.ungrouped.map((id) => ({ question_id: id, gap_id: null })), { onConflict: 'question_id', ignoreDuplicates: true });
        } else newGroups.push(...parsed.groups.filter((x) => !x.gapId && !x.entrySlug));
      }
    }

    // 6. Draft (Sonnet): open gaps without an answer, most asked first.
    const candidates: (GapRow & { samples?: string[] })[] = draftCandidates([...gaps.values()], settings.gapMaxGroupsPerNight);
    if (o.dry) for (const ng of newGroups) candidates.push({ id: `new:${ng.label}`, label: ng.label, status: 'open', entry_id: null, asked: ng.questionIds.length, draft_attempts: 0, last_asked_at: null, samples: ng.questionIds.map((id) => qById.get(id)?.question ?? '').filter(Boolean) });
    candidates.sort((a, b) => b.asked - a.asked);
    const shortlist = candidates.slice(0, settings.gapMaxGroupsPerNight);
    if (shortlist.length > 0) {
      const facts = SERVICE_FACTS;
      const knowledge = knowledgeForDrafting(live);
      const catalogue = catalogueForDrafting(g);
      const taken = new Set(rows.map((r) => r.slug));
      for (const gap of shortlist) {
        if (report.drafts.length >= settings.gapMaxGroupsPerNight) {
          report.stopped = 'max';
          break;
        }
        if (elapsed() > GAP_TIME_BUDGET_MS) {
          report.stopped = 'time';
          break;
        }
        const samples = gap.samples ?? (await samplesFor(admin, gap.id));
        const m = draftMessages({ facts, knowledge, catalogue, label: gap.label, samples });
        const worst = worstCasePence(MODEL_UNITS[GAP_DRAFT_MODEL], estimateTokens(m.system + m.user + JSON.stringify(DRAFT_SCHEMA)) + GAP_REQUEST_OVERHEAD_TOKENS, GAP_DRAFT_MAX_TOKENS, price);
        report.worstCasePence += worst;
        if (o.estimate) {
          report.drafts.push({ gap: gap.label, slug: null, covered: false, answer: null, missing: null, checks: [], error: 'estimate only: no model call' });
          continue;
        }
        if (!modelsConfigured()) {
          report.stopped = 'no_api_key';
          break;
        }
        if (!fitsCap(await spent(), worst, settings.gapMonthlyCapPence)) {
          report.stopped = 'cap';
          break;
        }
        const reply = await callModel({ model: GAP_DRAFT_MODEL, system: m.system, cacheSystem: true, user: m.user, schema: DRAFT_SCHEMA as unknown as Record<string, unknown>, maxTokens: GAP_DRAFT_MAX_TOKENS, ctx, label: 'drafting', price });
        await recordCost(reply.costPence);
        const draft = reply.text ? parseDraft(reply.text) : null;
        if (!draft) {
          const err = reply.error ?? 'the reply was not the JSON asked for';
          report.drafts.push({ gap: gap.label, slug: null, covered: false, answer: null, missing: null, checks: [], error: err });
          if (!o.dry && !gap.id.startsWith('new:')) {
            const attempts = gap.draft_attempts + 1;
            await admin.from('si_knowledge_gaps').update({ draft_attempts: attempts, last_error: err, status: attempts >= MAX_DRAFT_ATTEMPTS ? 'failed' : 'open', updated_at: new Date().toISOString() }).eq('id', gap.id);
          }
          continue;
        }
        const content: EntryContent = {
          question: draft.question,
          variants: samples.map(redactQuestion).filter((s) => s && s.toLowerCase() !== draft.question.toLowerCase()).slice(0, 5),
          answer: draft.covered ? draft.answer : '',
          category: draft.category,
          channels: ['call', 'chat'],
          showWhen: null,
        };
        const checks = draft.covered ? checkContent(content, g).errors : [];
        const note = draft.covered ? (checks.length ? `Drafted by the nightly job. Fix before approving: ${checks.join(' ')}` : 'Drafted by the nightly job from the service facts.') : `Not covered by the service facts: ${draft.missing || 'the facts do not say'}. Write the answer yourself, or reject it.`;
        const slug = uniqueSlug(draft.question || gap.label, taken);
        report.drafts.push({ gap: gap.label, slug, covered: draft.covered, answer: draft.covered ? draft.answer : null, missing: draft.covered ? null : draft.missing, checks, error: null });
        if (o.dry || gap.id.startsWith('new:')) continue;
        taken.add(slug);
        const created = await createEntry({ slug, content, source: 'gap', actor: 'nightly job', note }, admin);
        if (!created.ok) {
          await admin.from('si_knowledge_gaps').update({ draft_attempts: gap.draft_attempts + 1, last_error: created.error, updated_at: new Date().toISOString() }).eq('id', gap.id);
          continue;
        }
        await admin.from('si_knowledge_gaps').update({ entry_id: created.id, match_kind: 'draft', status: 'drafted', uncovered: !draft.covered, last_error: null, updated_at: new Date().toISOString() }).eq('id', gap.id);
      }
    }

    report.ms = Date.now() - started;
    if (runId) await admin.from('si_gap_runs').update({ status: 'done', finished_at: new Date().toISOString(), cost_pence: baseCost + report.costPence, report: summary(report, o.triggeredBy) }).eq('id', runId);
    console.log('[knowledge] gap job', JSON.stringify(summary(report, o.triggeredBy)));
    return { status: 200, body: report };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error('[knowledge] gap job failed:', message);
    if (runId) await admin.from('si_gap_runs').update({ status: 'failed', finished_at: new Date().toISOString(), cost_pence: baseCost + report.costPence, report: { ...summary(report, o.triggeredBy), error: message } }).eq('id', runId);
    return { status: 500, body: { ...report, error: message } };
  }
}

/** What a run row keeps: counts, no member text. */
function summary(r: GapRunReport, triggeredBy: string): Record<string, unknown> {
  return {
    triggeredBy,
    questions: r.questions.read,
    groups: r.grouping?.groups.length ?? 0,
    drafts: r.drafts.filter((d) => !d.error).length,
    draftErrors: r.drafts.filter((d) => d.error).length,
    newlyStale: r.stale?.newlyStale.length ?? 0,
    agent: r.agent,
    stopped: r.stopped,
    weekly: r.weekly ? `${r.weekly.status}${r.weekly.reason ? `: ${r.weekly.reason}` : ''}` : null,
    retention: r.retention ? ('error' in r.retention ? `error: ${r.retention.error}` : { questions: r.retention.questions, gaps: r.retention.gaps, more: r.retention.more }) : null,
    costPence: Math.round(r.costPence * 10_000) / 10_000,
    ms: r.ms,
  };
}
