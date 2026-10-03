/**
 * Batch 24: the Stayful Intelligence knowledge base's fixed numbers and
 * lists. Business numbers Zac tunes (thresholds, caps, retention) live in
 * billing_settings via ./settings.ts; everything here is structural and
 * changes only with a reviewed code change.
 *
 * Pure: no network, no database, no server-only.
 */

/** Where an approved answer may be used. `view` = may be a Stayful Intelligence chip. */
export const KB_CHANNELS = ['view', 'call', 'chat'] as const;
export type KbChannel = (typeof KB_CHANNELS)[number];
export const CHANNEL_LABEL: Record<KbChannel, string> = { view: 'Stayful Intelligence view', call: 'Calls', chat: 'Chat' };

export const KB_CATEGORIES = ['credit_billing', 'reports', 'deals', 'alerts', 'calls', 'account', 'how_it_works'] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<KbCategory, string> = {
  credit_billing: 'Credit and billing',
  reports: 'Reports and analyses',
  deals: 'Deals',
  alerts: 'Alerts',
  calls: 'Calls',
  account: 'Account',
  how_it_works: 'How it works',
};

export const KB_SOURCES = ['seed', 'gap', 'manual'] as const;
export type KbSource = (typeof KB_SOURCES)[number];

/** Answers are short: at most this many sentences and characters (a warning, not a block). */
export const ANSWER_MAX_SENTENCES = 2;
export const ANSWER_MAX_CHARS = 240;
/** Hard limits on what an entry may hold. */
export const QUESTION_MAX_CHARS = 200;
export const VARIANTS_MAX = 25;
export const VARIANT_MAX_CHARS = 200;
export const ANSWER_HARD_MAX_CHARS = 600;
export const SLUG_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

/**
 * Product facts an answer may quote that are not prices: fixed in the code
 * that does the work, so they live here as placeholders, never typed into an
 * answer. Change one only with the code it describes.
 */
export const PRODUCT_FACTS = {
  /** The Full analysis report's sections (src/lib/pdf/report). */
  reportSections: 10,
  /** The Full analysis forecast's months. */
  forecastMonths: 12,
  /** Stayful Management's fee, % of gross plus VAT (src/app/str-report/_lib/calculations.ts). */
  managementFeePct: 15,
  /** The methodology ledger: the properties Stayful took under management, and the year. */
  ledgerProperties: 6,
  ledgerYear: 2025,
} as const;

/** The contact address the agent and answers may give. */
export const TEAM_EMAIL = 'hello@stayful.co.uk';

/**
 * What a call says for a figure that could not be read at dial time. The
 * entry is marked stale at the same moment and the agent re-synced without
 * it, so this is said at most until the next sync.
 */
export const CALL_FIGURE_FALLBACK = 'shown in the app';

/** Credit bands for {credit_balance_band} (view and chat only, never a call): the upper bounds in pence. */
export const BALANCE_BANDS_PENCE = [500, 2000] as const;

/** How long the store keeps the live set before reading it again (admin writes clear it at once). */
export const LIVE_CACHE_MS = 30_000;

// ── The nightly gap job ─────────────────────────────────────────────────────

/** The question outcomes that make a gap. */
export const GAP_OUTCOMES = ['low_confidence', 'could_not_answer', 'member_unhappy'] as const;
export const GAP_GROUP_MODEL = 'claude-haiku-4-5';
export const GAP_DRAFT_MODEL = 'claude-sonnet-5-5';
/** Questions sent to the grouping model in one call (a long batch could run out of reply room and be re-sent every night). */
export const GAP_GROUP_BATCH = 40;
/** Room for one batch's grouping JSON: at most a new group per question, about 60 tokens each, with plenty to spare. */
export const GAP_GROUP_MAX_TOKENS = 6000;
/** Room for one drafted answer as JSON. */
export const GAP_DRAFT_MAX_TOKENS = 700;
/** A model call that takes longer than this is abandoned (the next night tries again). One retry, so a call can take twice this. */
export const GAP_MODEL_TIMEOUT_MS = 60_000;
/**
 * No new model call starts after this long in one run; the rest waits for the
 * next night. The route's maxDuration is 300 s: this plus one call at its
 * worst (two timeouts) plus the run's last writes stays under it.
 */
export const GAP_TIME_BUDGET_MS = 150_000;
/** Added to every worst-case token estimate: the structured-output schema and message framing the API counts as input. */
export const GAP_REQUEST_OVERHEAD_TOKENS = 500;
/** When the nightly job runs (vercel.json, /api/internal/si-knowledge), as shown on the Gaps page. */
export const GAP_SCHEDULE_TEXT = '02:50 UTC daily';
/** Up to this many phrasings are kept on a gap, as written. */
export const GAP_SAMPLES_MAX = 10;
/** A claimed run older than this with no finish is taken over. */
export const RUN_STALE_CLAIM_MS = 30 * 60_000;
/** The ledger action every gap-job model call is logged under (house spend). */
export const GAP_ACTION = 'si_gap_job';
/** Question text sent to a model is cut to this length. */
export const GAP_QUESTION_MAX_CHARS = 300;

// ── Coverage and the Monday email ──────────────────────────────────────────

export const COVERAGE_WEEKS = 12;
export const WEEKLY_TOP_GAPS = 5;

// ── Member facts ────────────────────────────────────────────────────────────

export const FACT_MAX_CHARS = 160;
export const FACT_ASKED_MAX_CHARS = 300;
export const FACT_CHANNELS = ['call', 'chat', 'view'] as const;
export type FactChannel = (typeof FACT_CHANNELS)[number];

/**
 * Words that mark a fact as something Stayful Intelligence must never keep:
 * health, protected characteristics, money beyond what the profile holds,
 * and other people. Matched on whole words, case-insensitive, after the
 * fact is lower-cased. The agent is told never to ask; this is the backstop.
 */
export const SENSITIVE_TERMS: Readonly<Record<string, readonly string[]>> = {
  health: ['health', 'ill', 'illness', 'sick', 'disease', 'diagnosed', 'diagnosis', 'cancer', 'diabetes', 'pregnant', 'pregnancy', 'disabled', 'disability', 'depression', 'depressed', 'anxiety', 'mental', 'medication', 'medicine', 'hospital', 'therapy', 'therapist', 'doctor', 'surgery', 'adhd', 'autism', 'autistic'],
  identity: ['religion', 'religious', 'christian', 'muslim', 'jewish', 'hindu', 'sikh', 'church', 'mosque', 'synagogue', 'ethnic', 'ethnicity', 'race', 'racial', 'gay', 'lesbian', 'bisexual', 'transgender', 'sexuality', 'sexual', 'political', 'politics', 'vote', 'voted', 'union', 'criminal', 'conviction', 'convicted', 'prison'],
  money: ['salary', 'wage', 'wages', 'payslip', 'debt', 'debts', 'arrears', 'bankrupt', 'bankruptcy', 'ccj', 'iva', 'benefits', 'universal credit', 'credit score', 'credit rating', 'overdraft', 'divorce', 'divorced', 'inheritance', 'pension', 'redundant', 'redundancy'],
  people: ['wife', 'husband', 'partner', 'girlfriend', 'boyfriend', 'son', 'daughter', 'kids', 'children', 'child', 'mum', 'mother', 'dad', 'father', 'brother', 'sister', 'friend', 'colleague', 'neighbour', 'neighbor', 'he', 'she', 'him', 'her', 'his', 'hers'],
};

// ── Matching ────────────────────────────────────────────────────────────────

/** Words that carry no meaning for matching. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'about', 'as', 'into', 'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'do', 'does', 'did', 'done', 'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'you', 'your', 'yours', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must', 'just', 'so', 'then', 'than', 'too', 'very', 'really', 'please', 'thanks', 'thank',
  'hi', 'hello', 'hey', 'ok', 'okay', 'um', 'uh', 'erm', 'er', 'like', 'yeah', 'yes', 'no', 'well', 'right', 'oh', 'actually', 'basically', 'quick', 'question',
  'what', 'whats', 'how', 'hows', 'when', 'where', 'which', 'who', 'why', 'tell', 'know', 'want', 'wanted', 'wondering', 'get', 'got', 'any', 'some', 'one',
  'have', 'has', 'had', 'having',
]);

/** Spellings that mean the same word, folded before matching (after lower-casing and stemming). */
export const SYNONYMS: Readonly<Record<string, string>> = {
  cost: 'price', costs: 'price', charge: 'price', charged: 'price', charges: 'price', fee: 'price', fees: 'price', pay: 'price', paid: 'price', expensive: 'price', cheap: 'price', much: 'price', pricing: 'price',
  topup: 'topup', recharge: 'topup', refill: 'topup',
  sms: 'text', message: 'text', messages: 'text', texts: 'text',
  phone: 'call', ring: 'call', rang: 'call', calls: 'call', calling: 'call',
  stop: 'cancel', unsubscribe: 'cancel', quit: 'cancel', end: 'cancel',
  unlock: 'open', opening: 'open', opened: 'open',
  analyse: 'analysis', analyze: 'analysis', report: 'analysis', reports: 'analysis',
  property: 'deal', properties: 'deal', listing: 'deal', listings: 'deal', deals: 'deal',
  alert: 'notify', alerts: 'notify', notification: 'notify', notifications: 'notify',
  subscription: 'plan', subscribe: 'plan', membership: 'plan',
  balance: 'credit', credits: 'credit', money: 'credit',
  pick: 'choose', picked: 'choose', picks: 'choose', select: 'choose', chosen: 'choose',
  remember: 'remember', memory: 'remember',
};

/** Multi-word or broken spellings joined before splitting (spoken transcripts and typing). */
export const COMPOUNDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btop[\s-]+ups?\b/g, 'topup'],
  [/\bp\s*m\s*i\b/g, 'pmi'],
  [/\bstay\s+full\b/g, 'stayful'],
  [/\bre[\s-]+let\b/g, 'relet'],
  [/\brent[\s-]+to[\s-]+rent\b/g, 'r2r'],
  [/\bshort[\s-]+lets?\b/g, 'shortlet'],
  [/\bair\s*b\s*n\s*b\b/g, 'airbnb'],
  [/\bsign[\s-]+up\b/g, 'signup'],
  [/\blog[\s-]+in\b/g, 'login'],
  [/\bfloor[\s-]+plans?\b/g, 'floorplan'],
];

/** The best score must beat the second-best entry's by this much to count as answered. */
export const MATCH_MIN_LEAD = 0.05;
/** At most this many matches are returned. */
export const MATCH_MAX_RESULTS = 5;
