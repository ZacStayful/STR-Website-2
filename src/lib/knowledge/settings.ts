/**
 * Batch 24: the knowledge base's business numbers. Each is a billing_settings
 * row with a default and bounds here, so a missing or bad row falls back to
 * the decided value rather than switching anything off or letting it run
 * wild. Edited on /admin/intelligence/knowledge (matching, facts) and
 * /admin/intelligence/gaps (the nightly job); seeded by the "Batch 24"
 * section of supabase/schema.sql.
 *
 * Pure: no network, no database, no server-only.
 */

export interface KnowledgeSettings {
  /** A question matched at or above this confidence is answered from the entry. */
  answerMinConfidence: number;
  /** Between this and answerMinConfidence the match is low confidence; below it, not answered. */
  lowConfidenceMin: number;
  /** The most gaps the nightly job drafts an answer for in one night. */
  gapMaxGroupsPerNight: number;
  /** The most new questions the nightly job reads in one night (the rest wait). */
  gapMaxQuestions: number;
  /** The nightly job's model spend per UK calendar month, raw pence (house spend). */
  gapMonthlyCapPence: number;
  /** The most facts Stayful Intelligence keeps per member. */
  factsMax: number;
  /** Member questions and their outcomes are deleted after this many months. */
  questionRetentionMonths: number;
}

export const KNOWLEDGE_SETTING_KEYS: Record<keyof KnowledgeSettings, string> = {
  answerMinConfidence: 'si_kb_answer_min_confidence',
  lowConfidenceMin: 'si_kb_low_confidence_min',
  gapMaxGroupsPerNight: 'si_gap_max_groups_per_night',
  gapMaxQuestions: 'si_gap_max_questions',
  gapMonthlyCapPence: 'si_gap_monthly_cap_pence',
  factsMax: 'si_facts_max',
  questionRetentionMonths: 'si_question_retention_months',
};

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  answerMinConfidence: 0.55,
  lowConfidenceMin: 0.3,
  gapMaxGroupsPerNight: 20,
  gapMaxQuestions: 200,
  gapMonthlyCapPence: 1500,
  factsMax: 30,
  questionRetentionMonths: 24,
};

interface Bound {
  min: number;
  max: number;
  whole: boolean;
}

export const KNOWLEDGE_SETTING_BOUNDS: Record<keyof KnowledgeSettings, Bound> = {
  answerMinConfidence: { min: 0.05, max: 1, whole: false },
  lowConfidenceMin: { min: 0, max: 0.95, whole: false },
  gapMaxGroupsPerNight: { min: 0, max: 100, whole: true },
  gapMaxQuestions: { min: 0, max: 2000, whole: true },
  gapMonthlyCapPence: { min: 0, max: 100_000, whole: true },
  factsMax: { min: 0, max: 200, whole: true },
  // Never under a year: a bad value must not empty the learning log.
  questionRetentionMonths: { min: 12, max: 120, whole: true },
};

const FIELDS = Object.keys(DEFAULT_KNOWLEDGE_SETTINGS) as (keyof KnowledgeSettings)[];

function inBounds(raw: unknown, b: Bound): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  if (b.whole && !Number.isInteger(n)) return null;
  return n >= b.min && n <= b.max ? n : null;
}

/**
 * The settings from billing_settings rows (key → value). Anything missing or
 * out of bounds takes its default, and so do the two thresholds together if
 * the low-confidence floor is not below the answered threshold.
 */
export function parseKnowledgeSettings(rows: ReadonlyMap<string, unknown>): KnowledgeSettings {
  const out = { ...DEFAULT_KNOWLEDGE_SETTINGS };
  for (const field of FIELDS) {
    const v = inBounds(rows.get(KNOWLEDGE_SETTING_KEYS[field]), KNOWLEDGE_SETTING_BOUNDS[field]);
    if (v !== null) out[field] = v;
  }
  if (!(out.lowConfidenceMin < out.answerMinConfidence)) {
    out.answerMinConfidence = DEFAULT_KNOWLEDGE_SETTINGS.answerMinConfidence;
    out.lowConfidenceMin = DEFAULT_KNOWLEDGE_SETTINGS.lowConfidenceMin;
  }
  return out;
}

/** "£15", "15.50", "1,000" → pence; null when it is not an amount. */
export function poundsToPence(raw: string | null): number | null {
  if (raw === null) return null;
  const s = raw.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export type FormResult<T> = { ok: true; settings: T } | { ok: false; error: string };

type Get = (name: string) => string | null;

function field(get: Get, name: keyof KnowledgeSettings, label: string): number | string {
  const b = KNOWLEDGE_SETTING_BOUNDS[name];
  const v = inBounds(get(name), b);
  if (v !== null) return v;
  return b.whole ? `${label} must be a whole number from ${b.min} to ${b.max}.` : `${label} must be a number from ${b.min} to ${b.max}.`;
}

/** The Knowledge page's form: the two match thresholds, the facts cap and retention. Every field is required. */
export function validateKnowledgeForm(get: Get): FormResult<Pick<KnowledgeSettings, 'answerMinConfidence' | 'lowConfidenceMin' | 'factsMax' | 'questionRetentionMonths'>> {
  const answerMinConfidence = field(get, 'answerMinConfidence', 'The answered threshold');
  if (typeof answerMinConfidence === 'string') return { ok: false, error: answerMinConfidence };
  const lowConfidenceMin = field(get, 'lowConfidenceMin', 'The low-confidence floor');
  if (typeof lowConfidenceMin === 'string') return { ok: false, error: lowConfidenceMin };
  if (!(lowConfidenceMin < answerMinConfidence)) return { ok: false, error: 'The low-confidence floor must be below the answered threshold.' };
  const factsMax = field(get, 'factsMax', 'Facts per member');
  if (typeof factsMax === 'string') return { ok: false, error: factsMax };
  const questionRetentionMonths = field(get, 'questionRetentionMonths', 'Question retention');
  if (typeof questionRetentionMonths === 'string') return { ok: false, error: questionRetentionMonths };
  return { ok: true, settings: { answerMinConfidence, lowConfidenceMin, factsMax, questionRetentionMonths } };
}

/** The Gaps page's form: the nightly job's limits. The cap is typed in pounds. */
export function validateGapForm(get: Get): FormResult<Pick<KnowledgeSettings, 'gapMaxGroupsPerNight' | 'gapMaxQuestions' | 'gapMonthlyCapPence'>> {
  const gapMaxGroupsPerNight = field(get, 'gapMaxGroupsPerNight', 'Drafts a night');
  if (typeof gapMaxGroupsPerNight === 'string') return { ok: false, error: gapMaxGroupsPerNight };
  const gapMaxQuestions = field(get, 'gapMaxQuestions', 'Questions a night');
  if (typeof gapMaxQuestions === 'string') return { ok: false, error: gapMaxQuestions };
  const capB = KNOWLEDGE_SETTING_BOUNDS.gapMonthlyCapPence;
  const gapMonthlyCapPence = poundsToPence(get('gapMonthlyCapPounds'));
  if (gapMonthlyCapPence === null || gapMonthlyCapPence < capB.min || gapMonthlyCapPence > capB.max) {
    return { ok: false, error: `The monthly cap must be an amount in pounds from £${capB.min / 100} to £${(capB.max / 100).toLocaleString('en-GB')}.` };
  }
  return { ok: true, settings: { gapMaxGroupsPerNight, gapMaxQuestions, gapMonthlyCapPence } };
}
