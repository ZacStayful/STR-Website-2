/**
 * Batch 27: the model's plan, checked before anything runs.
 *
 * The model proposes steps (propose_actions); this decides which may run.
 * Everything is checked against what the server itself knows, never against
 * what the model or the member says:
 *   - the kind must be one of STEP_KINDS (nothing on the "never" list exists)
 *   - a deal must be one this answer's own look-ups returned (my_deals,
 *     deal_facts, todays_picks: the member's own, visible deals; the 48-hour
 *     delay is already applied there), so no text can point at another
 *     member's deal or one a free member can't see
 *   - a stage past Kept needs the deal opened (setStageForMember's own rule)
 *   - a link must be one the listing check can fetch
 *   - a profile change must be one of CRITERIA_QUESTIONS, and a deal type is
 *     only removed when the member's own words ask for it
 *   - no repeats, and no more deals than si_action_max_targets
 * Invalid steps are dropped with a reason the eye says.
 *
 * Pure: no network, no database, no server-only.
 */
import { detectListingUrl, SERVER_FETCHABLE } from '../listing/detect.ts';
import { stageNeedsOpen, type PipelineStatus } from '../listing/pipeline.ts';
import { CHARGED_KINDS, CRITERIA_QUESTIONS, isCriteriaQuestion, isStepKind, MAX_PROPOSED_STEPS, STEP_STAGES, type CriteriaQuestion, type DropReason } from './config.ts';

/** One step as the tool call gave it (strings checked here, never trusted). */
export interface ProposedStep {
  action: string;
  dealId: string | null;
  stage: string | null;
  url: string | null;
  question: string | null;
  value: string | null;
}

/** What the server knows about a deal this answer's look-ups returned. */
export interface PlanDeal {
  dealId: string;
  /** How the eye names it: area and type, never an address ("2-bed flat in LS6"). */
  label: string;
  /** Its stage in My deals, or null when it isn't there. */
  stage: PipelineStatus | null;
  /** The team has opened it (or an admin): the address may be used. */
  opened: boolean;
  /** It has a full report the member can read. */
  analysed: boolean;
}

export interface PlanContext {
  /** Only the deals this answer's look-ups returned. */
  deals: ReadonlyMap<string, PlanDeal>;
  maxTargets: number;
  /** The member's own words, for "remove" in plain words. */
  question: string;
  deepSearch: 'available' | 'off' | 'running';
  /** The member may check listings (the Explorer's own rule). */
  linkChecks: boolean;
}

export type ValidStep =
  | { kind: 'keep' | 'pass' | 'stage_move'; dealId: string; label: string; stage: PipelineStatus; from: PipelineStatus | null }
  | { kind: 'full_analysis'; dealId: string; label: string; opened: boolean }
  /** addOn: the deal already has its full report, so the Deep report is the PMI second opinion added to it. */
  | { kind: 'deep_report'; dealId: string; label: string; opened: boolean; addOn: boolean }
  | { kind: 'deep_search' }
  | { kind: 'check_link'; url: string; source: string }
  | { kind: 'change_criteria'; question: CriteriaQuestion; value: string };

export interface DroppedStep {
  action: string;
  /** The deal's label, the link's site or the profile question: what the eye names when it says why. */
  target: string | null;
  reason: DropReason;
}

export interface CheckedPlan {
  steps: ValidStep[];
  dropped: DroppedStep[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The names a member uses for each deal type (Batch 17's three available types). */
const TYPE_WORDS: Record<string, readonly string[]> = {
  buy_str: ['short-let', 'short let', 'shortlet', 'short-lets', 'short lets', 'holiday let', 'serviced accommodation'],
  brrr: ['brrr', 'brr'],
  r2r: ['rent-to-rent', 'rent to rent', 'r2r'],
};

const REMOVE_WORDS = /\b(remove|drop|stop|exclude|no more|take (?:off|out)|get rid of|don't want|do not want|not interested in)\b/g;
/** Words between the removal and the type that turn it round ("I don't want to lose short-lets"). */
const KEEP_WORDS = /\b(lose|losing|keep|keeping|miss|missing|but|except)\b/;
/** The most words between the removal and the type ("stop showing me BRRR"). */
const REMOVE_GAP_WORDS = 4;

/**
 * Zac (29 Sep): a deal type is never removed unless the member says so in
 * plain words. True only when their own question has a removal word, not
 * negated ("don't stop…"), followed within a few words by the type's name
 * with nothing that turns it round in between.
 */
export function memberAskedToRemove(question: string, type: string): boolean {
  const words = TYPE_WORDS[type];
  if (!words) return false;
  const q = question.toLowerCase().replace(/[‘’]/g, "'");
  for (const m of q.matchAll(REMOVE_WORDS)) {
    const at = m.index ?? 0;
    if (/\b(don't|do not|never|not|didn't|won't)\s+$/.test(q.slice(Math.max(0, at - 12), at))) continue;
    const after = q.slice(at + m[0].length, at + m[0].length + 80);
    for (const w of words) {
      const i = after.indexOf(w);
      if (i < 0) continue;
      const gap = after.slice(0, i).trim();
      if (gap.split(/\s+/).filter(Boolean).length > REMOVE_GAP_WORDS || KEEP_WORDS.test(gap)) continue;
      return true;
    }
  }
  return false;
}

/** The listing links in the member's own message, canonical: the only links the eye may check (never one it made up). */
function linksIn(question: string): Set<string> {
  const out = new Set<string>();
  for (const token of question.split(/\s+/)) {
    const d = detectListingUrl(token.replace(/^[<(\[]+|[>)\].,;:!?'"]+$/g, ''));
    if (d) out.add(d.canonicalUrl);
  }
  return out;
}

/** The deal type a criteria value names: its id or one of its names. Null for anything else. */
export function dealTypeOf(value: string): string | null {
  const v = value.trim().toLowerCase();
  for (const [type, words] of Object.entries(TYPE_WORDS)) if (v === type || words.includes(v)) return type;
  return null;
}

/** Postcode areas from "BD", "BD, LS" or "bd ls": one or two letters each, upper-cased, no repeats. */
export function areaCodes(value: string): string[] {
  const out: string[] = [];
  for (const part of value.toUpperCase().split(/[\s,;/]+/)) {
    if (/^[A-Z]{1,2}$/.test(part) && !out.includes(part)) out.push(part);
  }
  return out;
}

/** The deal a step names, when this answer's look-ups returned it. */
function dealTarget(step: ProposedStep, ctx: PlanContext): PlanDeal | DropReason {
  const id = (step.dealId ?? '').trim().toLowerCase();
  if (!UUID.test(id)) return 'not_seen';
  return ctx.deals.get(id) ?? 'not_seen';
}

function stageFor(kind: 'keep' | 'pass' | 'stage_move', raw: string | null): PipelineStatus | null {
  if (kind === 'keep') return 'watching';
  if (kind === 'pass') return 'passed';
  return (STEP_STAGES as readonly string[]).includes(raw ?? '') ? (raw as PipelineStatus) : null;
}

/** Checks one proposal. Steps keep the order the model gave (that is the order they are charged in). */
export function checkPlan(proposed: readonly ProposedStep[], ctx: PlanContext): CheckedPlan {
  const steps: ValidStep[] = [];
  const dropped: DroppedStep[] = [];
  const seen = new Set<string>();
  let asked: Set<string> | undefined;
  const targets = new Set<string>();
  const drop = (step: ProposedStep, reason: DropReason, target: string | null = null) => dropped.push({ action: String(step.action ?? '').slice(0, 40), target, reason });

  for (const [i, step] of proposed.entries()) {
    if (i >= MAX_PROPOSED_STEPS) {
      drop(step, 'too_many');
      continue;
    }
    const kind = step.action;
    if (!isStepKind(kind)) {
      drop(step, 'unknown');
      continue;
    }

    if (kind === 'keep' || kind === 'pass' || kind === 'stage_move' || kind === 'full_analysis' || kind === 'deep_report') {
      const deal = dealTarget(step, ctx);
      if (typeof deal === 'string') {
        drop(step, deal);
        continue;
      }
      // One analysis per deal: a deep report is a Full analysis with PMI's opinion, so asking for both is one deep
      // report (two would price the open twice, and the second start would cancel the first's purchase).
      const key = `${kind === 'deep_report' || kind === 'full_analysis' ? 'analysis' : 'stage'}:${deal.dealId}`;
      if (seen.has(key)) {
        const earlier = kind === 'deep_report' ? steps.findIndex((s) => s.kind === 'full_analysis' && s.dealId === deal.dealId) : -1;
        if (earlier >= 0) steps[earlier] = { kind: 'deep_report', dealId: deal.dealId, label: deal.label, opened: deal.opened, addOn: deal.analysed };
        else drop(step, 'duplicate', deal.label);
        continue;
      }
      if (!targets.has(deal.dealId) && targets.size >= ctx.maxTargets) {
        drop(step, 'too_many', deal.label);
        continue;
      }
      if (kind === 'full_analysis' || kind === 'deep_report') {
        if (kind === 'full_analysis' && deal.analysed) {
          drop(step, 'already_done', deal.label);
          continue;
        }
        seen.add(key);
        targets.add(deal.dealId);
        steps.push(kind === 'full_analysis' ? { kind, dealId: deal.dealId, label: deal.label, opened: deal.opened } : { kind, dealId: deal.dealId, label: deal.label, opened: deal.opened, addOn: deal.analysed });
        continue;
      }
      const stage = stageFor(kind, step.stage);
      if (!stage) {
        drop(step, 'bad_value', deal.label);
        continue;
      }
      if (deal.stage === stage) {
        drop(step, 'already_there', deal.label);
        continue;
      }
      // setStageForMember's own rule: past Kept needs the address, so the deal opened. Never opened here.
      if (stageNeedsOpen(stage) && !deal.opened) {
        drop(step, 'needs_open', deal.label);
        continue;
      }
      seen.add(key);
      targets.add(deal.dealId);
      steps.push({ kind, dealId: deal.dealId, label: deal.label, stage, from: deal.stage });
      continue;
    }

    if (kind === 'deep_search') {
      if (seen.has('deep_search')) {
        drop(step, 'duplicate');
        continue;
      }
      if (ctx.deepSearch !== 'available') {
        drop(step, ctx.deepSearch === 'running' ? 'deep_search_running' : 'deep_search_off');
        continue;
      }
      seen.add('deep_search');
      steps.push({ kind });
      continue;
    }

    if (kind === 'check_link') {
      const detected = detectListingUrl(step.url ?? '');
      if (!detected) {
        drop(step, 'unsupported_site');
        continue;
      }
      if (!SERVER_FETCHABLE.has(detected.source)) {
        drop(step, 'needs_extension', detected.source);
        continue;
      }
      if (!ctx.linkChecks) {
        drop(step, 'no_link_checks', detected.source);
        continue;
      }
      if (!(asked ??= linksIn(ctx.question)).has(detected.canonicalUrl)) {
        drop(step, 'link_not_given', detected.source);
        continue;
      }
      const key = `link:${detected.canonicalUrl}`;
      if (seen.has(key)) {
        drop(step, 'duplicate', detected.source);
        continue;
      }
      if (targets.size >= ctx.maxTargets) {
        drop(step, 'too_many', detected.source);
        continue;
      }
      seen.add(key);
      targets.add(key);
      steps.push({ kind, url: detected.canonicalUrl, source: detected.source });
      continue;
    }

    // change_criteria
    const question = step.question;
    const value = (step.value ?? '').trim().slice(0, 80);
    if (!isCriteriaQuestion(question) || !value) {
      drop(step, 'bad_value', typeof question === 'string' ? question.slice(0, 40) : null);
      continue;
    }
    if (question === 'remove_deal_type') {
      const type = dealTypeOf(value);
      if (!type) {
        drop(step, 'bad_value', question);
        continue;
      }
      if (!memberAskedToRemove(ctx.question, type)) {
        drop(step, 'not_asked_to_remove', type);
        continue;
      }
    }
    if (question === 'add_deal_type' && !dealTypeOf(value)) {
      drop(step, 'bad_value', question);
      continue;
    }
    if (question === 'add_areas' && areaCodes(value).length === 0) {
      drop(step, 'bad_value', question);
      continue;
    }
    // One change per answer: two to the same question would leave only the last.
    const key = `criteria:${question === 'add_deal_type' || question === 'remove_deal_type' ? 'deal_types' : question}`;
    if (seen.has(key)) {
      drop(step, 'duplicate', question);
      continue;
    }
    seen.add(key);
    steps.push({ kind: 'change_criteria', question, value });
  }
  return { steps, dropped };
}

/** Whether a checked step costs credit. */
export function isCharged(step: ValidStep): boolean {
  return CHARGED_KINDS.has(step.kind);
}

/** The questions a criteria step may name, for the tool's schema. */
export const CRITERIA_QUESTION_LIST: readonly string[] = CRITERIA_QUESTIONS;
