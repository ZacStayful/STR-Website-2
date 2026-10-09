/**
 * Batch 26: the typed chat's business numbers. Each is a billing_settings row
 * with a default and bounds here, so a missing or bad row falls back to the
 * decided value rather than switching anything off or letting it run wild.
 * Edited on /admin/intelligence/chat; seeded by the "Batch 26" section of
 * supabase/schema.sql. Prices are base pence, like every other price.
 *
 * Pure: no network, no database, no server-only.
 */

export interface ChatSettings {
  /** Off hides the box (SI_CHAT_ENABLED=true is also needed). */
  enabled: boolean;
  /** Off hides the microphone and answers aren't spoken (typing still works). */
  voice: boolean;
  /** A question costs its actual tokens × this. */
  markup: number;
  /** The most one quick answer can cost, base pence; the answer is sized to fit. */
  quickCeilingPence: number;
  /** The most one full-view answer can cost, base pence. */
  fullCeilingPence: number;
  /** Below this spendable balance the quick box says "Top up to ask me more". */
  quickFloorPence: number;
  /** The same for the full view. */
  fullFloorPence: number;
  /** The price hint by the quick box ("about 1p"). */
  quickHintPence: number;
  /** The price hint by the full view's box ("about 8p"). */
  fullHintPence: number;
  /** A quick answer's longest reply, in tokens. */
  quickMaxOutputTokens: number;
  /** A full-view answer's longest text, in words. */
  fullMaxWords: number;
  /** The most times one full-view answer may look something up. */
  fullMaxToolRounds: number;
  /** Earlier questions in the same conversation sent back with a new one. */
  historyTurns: number;
  /** A full-view conversation ends after this long without a question. */
  sessionIdleMinutes: number;
  /** The shortest gap between two questions from one member, seconds. */
  minSeconds: number;
  /** Unanswered (uncharged) questions a member may ask in a UK day; answered ones are never capped. */
  maxUnchargedPerDay: number;
}

type NumberField = Exclude<keyof ChatSettings, 'enabled' | 'voice'>;

export const CHAT_SETTING_KEYS: Record<keyof ChatSettings, string> = {
  enabled: 'si_chat_enabled',
  voice: 'si_chat_voice_enabled',
  markup: 'si_chat_markup',
  quickCeilingPence: 'si_chat_quick_ceiling_pence',
  fullCeilingPence: 'si_chat_full_ceiling_pence',
  quickFloorPence: 'si_chat_quick_floor_pence',
  fullFloorPence: 'si_chat_full_floor_pence',
  quickHintPence: 'si_chat_quick_hint_pence',
  fullHintPence: 'si_chat_full_hint_pence',
  quickMaxOutputTokens: 'si_chat_quick_max_output_tokens',
  fullMaxWords: 'si_chat_full_max_words',
  fullMaxToolRounds: 'si_chat_full_max_tool_rounds',
  historyTurns: 'si_chat_history_turns',
  sessionIdleMinutes: 'si_chat_session_idle_minutes',
  minSeconds: 'si_chat_min_seconds',
  maxUnchargedPerDay: 'si_chat_max_uncharged_per_day',
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enabled: true,
  voice: true,
  markup: 5,
  quickCeilingPence: 3,
  fullCeilingPence: 25,
  quickFloorPence: 2,
  fullFloorPence: 10,
  quickHintPence: 1,
  fullHintPence: 8,
  quickMaxOutputTokens: 200,
  fullMaxWords: 80,
  fullMaxToolRounds: 4,
  historyTurns: 6,
  sessionIdleMinutes: 30,
  minSeconds: 3,
  maxUnchargedPerDay: 30,
};

interface Bound {
  min: number;
  max: number;
  whole: boolean;
}

export const CHAT_SETTING_BOUNDS: Record<NumberField, Bound> = {
  markup: { min: 1, max: 20, whole: false },
  quickCeilingPence: { min: 0.5, max: 50, whole: false },
  fullCeilingPence: { min: 1, max: 200, whole: false },
  quickFloorPence: { min: 0, max: 50, whole: false },
  fullFloorPence: { min: 0, max: 200, whole: false },
  quickHintPence: { min: 0, max: 50, whole: false },
  fullHintPence: { min: 0, max: 200, whole: false },
  quickMaxOutputTokens: { min: 60, max: 600, whole: true },
  fullMaxWords: { min: 30, max: 250, whole: true },
  fullMaxToolRounds: { min: 0, max: 8, whole: true },
  historyTurns: { min: 0, max: 20, whole: true },
  sessionIdleMinutes: { min: 5, max: 1440, whole: true },
  // Never 0: one question in flight is the double-send guard, this is the abuse guard.
  minSeconds: { min: 1, max: 60, whole: true },
  maxUnchargedPerDay: { min: 0, max: 1000, whole: true },
};

const NUMBER_FIELDS = Object.keys(CHAT_SETTING_BOUNDS) as NumberField[];

export const CHAT_SETTING_LABELS: Record<NumberField, string> = {
  markup: 'Markup',
  quickCeilingPence: 'Quick answer ceiling',
  fullCeilingPence: 'Full view ceiling',
  quickFloorPence: 'Quick answer floor',
  fullFloorPence: 'Full view floor',
  quickHintPence: 'Quick answer price hint',
  fullHintPence: 'Full view price hint',
  quickMaxOutputTokens: 'Quick answer length (tokens)',
  fullMaxWords: 'Full view answer length (words)',
  fullMaxToolRounds: 'Look-ups per full-view answer',
  historyTurns: 'Earlier questions sent back',
  sessionIdleMinutes: 'Conversation ends after (minutes)',
  minSeconds: 'Seconds between questions',
  maxUnchargedPerDay: 'Unanswered questions a day',
};

function inBounds(raw: unknown, b: Bound): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  if (b.whole && !Number.isInteger(n)) return null;
  return n >= b.min && n <= b.max ? n : null;
}

/**
 * The settings from billing_settings rows (key → value). Anything missing or
 * out of bounds takes its default; a floor above its ceiling takes the
 * ceiling (a member who can afford the most a question can cost can ask).
 */
export function parseChatSettings(rows: ReadonlyMap<string, unknown>): ChatSettings {
  const out: ChatSettings = { ...DEFAULT_CHAT_SETTINGS };
  const enabled = rows.get(CHAT_SETTING_KEYS.enabled);
  if (enabled === false || enabled === 'false') out.enabled = false;
  const voice = rows.get(CHAT_SETTING_KEYS.voice);
  if (voice === false || voice === 'false') out.voice = false;
  for (const field of NUMBER_FIELDS) {
    const v = inBounds(rows.get(CHAT_SETTING_KEYS[field]), CHAT_SETTING_BOUNDS[field]);
    if (v !== null) out[field] = v;
  }
  out.quickFloorPence = Math.min(out.quickFloorPence, out.quickCeilingPence);
  out.fullFloorPence = Math.min(out.fullFloorPence, out.fullCeilingPence);
  return out;
}

export type ChatFormResult = { ok: true; settings: ChatSettings } | { ok: false; error: string };

/** The Chat admin page's form. Every number is required; the switch is a checkbox. */
export function validateChatForm(get: (name: string) => string | null): ChatFormResult {
  const on = (name: string) => get(name) === 'on' || get(name) === 'true';
  const out: ChatSettings = { ...DEFAULT_CHAT_SETTINGS, enabled: on('enabled'), voice: on('voice') };
  for (const field of NUMBER_FIELDS) {
    const b = CHAT_SETTING_BOUNDS[field];
    const v = inBounds(get(field), b);
    if (v === null) {
      const label = CHAT_SETTING_LABELS[field];
      return { ok: false, error: b.whole ? `${label} must be a whole number from ${b.min} to ${b.max}.` : `${label} must be a number from ${b.min} to ${b.max}.` };
    }
    out[field] = v;
  }
  if (out.quickFloorPence > out.quickCeilingPence) return { ok: false, error: 'The quick answer floor must not be above its ceiling.' };
  if (out.fullFloorPence > out.fullCeilingPence) return { ok: false, error: 'The full view floor must not be above its ceiling.' };
  return { ok: true, settings: out };
}
