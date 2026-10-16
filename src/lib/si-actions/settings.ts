/**
 * Batch 27: the numbers Zac tunes for Stayful Intelligence's actions,
 * billing_settings rows edited on /admin/intelligence/actions. A missing or
 * out-of-bounds row takes its default. The low-credit line isn't here: it is
 * Batch 20's low_credit_pence (src/lib/lifecycle/settings.ts), so the eye's
 * confirm, the low-credit email and the low-credit call all use one line.
 *
 * Pure: no network, no database, no server-only.
 */

export interface ActionSettings {
  /** Off: the eye answers but does nothing (Batch 26's buttons only). */
  enabled: boolean;
  /** One instruction's action charges past this (face pence) wait for the member's yes (Zac: £20). */
  instructionCapPence: number;
  /** How long Keep/Pass, stage moves and profile changes can be undone (Zac: 24 hours). */
  undoHours: number;
  /** The Stop countdown before the first charged step starts. */
  stopGraceSeconds: number;
  /** Instructions a member may give in an hour, and in a UK day. */
  ratePerHour: number;
  ratePerDay: number;
  /** The most deals one instruction may touch. */
  maxTargets: number;
  /** A countdown or confirm nobody answers expires after this. */
  confirmMinutes: number;
}

type NumberField = Exclude<keyof ActionSettings, 'enabled'>;

export const ACTION_SETTING_KEYS: Record<keyof ActionSettings, string> = {
  enabled: 'si_action_enabled',
  instructionCapPence: 'si_action_instruction_cap_pence',
  undoHours: 'si_action_undo_hours',
  stopGraceSeconds: 'si_action_stop_grace_seconds',
  ratePerHour: 'si_action_rate_per_hour',
  ratePerDay: 'si_action_rate_per_day',
  maxTargets: 'si_action_max_targets',
  confirmMinutes: 'si_action_confirm_minutes',
};

export const DEFAULT_ACTION_SETTINGS: ActionSettings = {
  enabled: true,
  instructionCapPence: 2000,
  undoHours: 24,
  stopGraceSeconds: 5,
  ratePerHour: 20,
  ratePerDay: 60,
  maxTargets: 50,
  confirmMinutes: 10,
};

interface Bound {
  min: number;
  max: number;
}

export const ACTION_SETTING_BOUNDS: Record<NumberField, Bound> = {
  instructionCapPence: { min: 100, max: 20000 },
  undoHours: { min: 1, max: 168 },
  // Never 0: the countdown is what makes Stop possible before anything is charged.
  stopGraceSeconds: { min: 2, max: 30 },
  ratePerHour: { min: 1, max: 200 },
  ratePerDay: { min: 1, max: 1000 },
  maxTargets: { min: 1, max: 200 },
  confirmMinutes: { min: 1, max: 120 },
};

const NUMBER_FIELDS = Object.keys(ACTION_SETTING_BOUNDS) as NumberField[];

export const ACTION_SETTING_LABELS: Record<NumberField, string> = {
  instructionCapPence: 'Ask before spending more than (pence, one instruction)',
  undoHours: 'Undo window (hours)',
  stopGraceSeconds: 'Stop countdown (seconds)',
  ratePerHour: 'Instructions an hour',
  ratePerDay: 'Instructions a day',
  maxTargets: 'Deals one instruction may touch',
  confirmMinutes: 'A confirm expires after (minutes)',
};

function inBounds(raw: unknown, b: Bound): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n >= b.min && n <= b.max ? n : null;
}

export function parseActionSettings(rows: ReadonlyMap<string, unknown>): ActionSettings {
  const out: ActionSettings = { ...DEFAULT_ACTION_SETTINGS };
  const enabled = rows.get(ACTION_SETTING_KEYS.enabled);
  if (enabled === false || enabled === 'false') out.enabled = false;
  for (const field of NUMBER_FIELDS) {
    const v = inBounds(rows.get(ACTION_SETTING_KEYS[field]), ACTION_SETTING_BOUNDS[field]);
    if (v !== null) out[field] = v;
  }
  out.ratePerHour = Math.min(out.ratePerHour, out.ratePerDay);
  return out;
}

export type ActionFormResult = { ok: true; settings: ActionSettings } | { ok: false; error: string };

/** The admin form: every number required and in bounds; the switch is a checkbox. */
export function validateActionForm(get: (name: string) => string | null): ActionFormResult {
  const out: ActionSettings = { ...DEFAULT_ACTION_SETTINGS, enabled: get('enabled') === 'on' || get('enabled') === 'true' };
  for (const field of NUMBER_FIELDS) {
    const b = ACTION_SETTING_BOUNDS[field];
    const v = inBounds(get(field), b);
    if (v === null) return { ok: false, error: `${ACTION_SETTING_LABELS[field]} must be a whole number from ${b.min} to ${b.max}.` };
    out[field] = v;
  }
  if (out.ratePerHour > out.ratePerDay) return { ok: false, error: 'Instructions an hour must not be more than instructions a day.' };
  return { ok: true, settings: out };
}
