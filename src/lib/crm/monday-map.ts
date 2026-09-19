/**
 * Mapping a lead onto a customer's Monday board.
 *
 * Every board has different column ids — `text_mm3ad9y7` on ours means
 * nothing on theirs — so the customer picks which of their columns receives
 * each field, and that choice is stored on the connection. This module turns
 * a mapping plus a lead into the `column_values` JSON Monday wants.
 *
 * The thing that makes this fiddly is that Monday's accepted value SHAPE
 * depends on the column's TYPE, not on what you are putting in it. An email
 * column wants `{ email, text }`; a text column holding an email address
 * wants the bare string. Send the wrong shape and Monday rejects the entire
 * mutation — not the one column — so a single bad mapping loses the whole
 * lead.
 *
 * Which is why an unrecognised column type is SKIPPED rather than guessed.
 * Dropping one field costs a phone number; guessing costs the lead.
 *
 * Pure, so the shapes are pinned by tests rather than discovered when a
 * customer's first real lead fails to arrive.
 */

import type { LeadPayload } from './types.ts';

/** The lead fields a customer can point at one of their columns. */
export type MondayFieldId =
  | 'email'
  | 'phone'
  | 'address'
  | 'postcode'
  | 'bedrooms'
  | 'revenue'
  | 'qualified'
  | 'summary'
  | 'reportUrl'
  | 'date'
  | 'file';

export const MONDAY_FIELDS: Array<{ id: MondayFieldId; label: string; hint: string }> = [
  { id: 'email', label: 'Email', hint: 'The prospect’s email address' },
  { id: 'phone', label: 'Phone', hint: 'Their phone number, when they gave one' },
  { id: 'address', label: 'Property address', hint: 'The property they asked about' },
  { id: 'postcode', label: 'Postcode', hint: 'Postcode of that property' },
  { id: 'bedrooms', label: 'Bedrooms', hint: 'Bedroom count' },
  { id: 'revenue', label: 'Projected revenue', hint: 'Projected annual gross, in pounds' },
  { id: 'qualified', label: 'Qualified', hint: 'Whether the lead met your rules' },
  { id: 'summary', label: 'Qualification notes', hint: 'Why a lead did or did not qualify' },
  { id: 'reportUrl', label: 'Report link', hint: 'Link to the full report' },
  { id: 'date', label: 'Date received', hint: 'When the lead came in' },
  { id: 'file', label: 'Report PDF', hint: 'The PDF is uploaded into this column' },
];

/** One mapped column: their id, and the type we read off their board. */
export interface MappedColumn {
  id: string;
  type: string;
}

export interface MondayConfig {
  boardId: string | null;
  /** Null lands the item in the board's first group, which is Monday's default. */
  groupId: string | null;
  columns: Partial<Record<MondayFieldId, MappedColumn>>;
  /** What to write into a status/dropdown column for each verdict. */
  qualifiedLabels: { yes: string; no: string };
}

export const EMPTY_MONDAY_CONFIG: MondayConfig = {
  boardId: null,
  groupId: null,
  columns: {},
  qualifiedLabels: { yes: 'Qualified', no: 'Not qualified' },
};

const FIELD_IDS = new Set<string>(MONDAY_FIELDS.map((f) => f.id));

function str(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
}

/**
 * Tolerant parse of the stored config, in the same spirit as `parseLeadRules`:
 * an unusable value becomes "not mapped" rather than throwing. A lead landing
 * with three fields filled in is recoverable; a crash in the delivery cron is
 * not.
 */
export function parseMondayConfig(raw: unknown): MondayConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_MONDAY_CONFIG;
  const o = raw as Record<string, unknown>;

  const columns: Partial<Record<MondayFieldId, MappedColumn>> = {};
  const rawCols = o.columns;
  if (rawCols && typeof rawCols === 'object' && !Array.isArray(rawCols)) {
    for (const [key, value] of Object.entries(rawCols as Record<string, unknown>)) {
      if (!FIELD_IDS.has(key)) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const v = value as Record<string, unknown>;
      const id = str(v.id);
      const type = str(v.type);
      // Both halves or neither: a column id without its type cannot be
      // formatted safely, and formatting it wrongly fails the whole push.
      if (id === null || type === null) continue;
      columns[key as MondayFieldId] = { id, type: type.toLowerCase() };
    }
  }

  const labels = o.qualifiedLabels;
  const yes = labels && typeof labels === 'object' ? str((labels as Record<string, unknown>).yes) : null;
  const no = labels && typeof labels === 'object' ? str((labels as Record<string, unknown>).no) : null;

  return {
    boardId: str(o.boardId),
    groupId: str(o.groupId),
    columns,
    qualifiedLabels: {
      yes: yes ?? EMPTY_MONDAY_CONFIG.qualifiedLabels.yes,
      no: no ?? EMPTY_MONDAY_CONFIG.qualifiedLabels.no,
    },
  };
}

/** A connection can only be used once it knows which board to write to. */
export function mondayConfigBlockers(config: MondayConfig): string[] {
  const out: string[] = [];
  if (config.boardId === null) out.push('Choose the board your leads should land on.');
  if (!config.columns.email) out.push('Map the Email field — it is how a lead is matched and followed up.');
  return out;
}

// ─── Value formatting ─────────────────────────────────────────────────

/**
 * Monday column types we know how to write, grouped by the shape they take.
 * Anything not listed here is skipped by `mondayColumnValues`; see the note
 * at the top of the file.
 */
const PLAIN_TEXT_TYPES = new Set(['text', 'long_text', 'long-text', 'name']);
const NUMBER_TYPES = new Set(['numbers', 'numeric', 'number']);
const LABEL_TYPES = new Set(['status', 'color', 'dropdown']);
const LINK_TYPES = new Set(['link']);
const DATE_TYPES = new Set(['date']);
const EMAIL_TYPES = new Set(['email']);
const PHONE_TYPES = new Set(['phone']);
const CHECKBOX_TYPES = new Set(['checkbox', 'boolean']);

export function isWritableColumnType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    PLAIN_TEXT_TYPES.has(t) || NUMBER_TYPES.has(t) || LABEL_TYPES.has(t) || LINK_TYPES.has(t) ||
    DATE_TYPES.has(t) || EMAIL_TYPES.has(t) || PHONE_TYPES.has(t) || CHECKBOX_TYPES.has(t)
  );
}

/** Monday's date value is UTC, split into its two halves. */
function dateValue(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const s = d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 19) };
}

/**
 * Formats one value for one column type. Returns `undefined` when the value
 * should not be sent at all — an unknown type, or nothing to say. A null
 * would CLEAR the customer's column, which is not the same thing and is not
 * ours to do.
 */
export function formatColumnValue(type: string, value: string | number | boolean | null): unknown | undefined {
  if (value === null) return undefined;
  const t = type.toLowerCase();
  const text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  if (text.trim().length === 0) return undefined;

  if (PLAIN_TEXT_TYPES.has(t)) return text;
  if (NUMBER_TYPES.has(t)) {
    const n = typeof value === 'number' ? value : Number(text.replace(/[£,\s]/g, ''));
    // Monday wants numbers as strings; a NaN here would fail the mutation.
    return Number.isFinite(n) ? String(n) : undefined;
  }
  if (LABEL_TYPES.has(t)) return { label: text };
  if (LINK_TYPES.has(t)) return { url: text, text };
  if (EMAIL_TYPES.has(t)) return { email: text, text };
  // No country is sent: guessing one on a number the prospect typed is how a
  // UK mobile ends up filed as American.
  if (PHONE_TYPES.has(t)) return { phone: text };
  if (CHECKBOX_TYPES.has(t)) return { checked: value === true || text === 'Yes' ? 'true' : 'false' };
  if (DATE_TYPES.has(t)) return dateValue(text) ?? undefined;
  return undefined;
}

/**
 * The `column_values` object for one lead. Skips anything unmapped, anything
 * with nothing to say, and anything whose column type we cannot write — so a
 * partial mapping produces a partial row rather than a failed push.
 */
export function mondayColumnValues(config: MondayConfig, payload: LeadPayload): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  const put = (field: MondayFieldId, raw: string | number | boolean | null) => {
    const col = config.columns[field];
    if (!col) return;
    const formatted = formatColumnValue(col.type, raw);
    if (formatted === undefined) return;
    values[col.id] = formatted;
  };

  put('email', payload.contact.email);
  put('phone', payload.contact.phone);
  put('address', payload.property.address);
  put('postcode', payload.property.postcode);
  put('bedrooms', payload.property.bedrooms);
  put('revenue', payload.metrics.annualRevenue);
  put('reportUrl', payload.report.url);
  put('summary', payload.qualification.summary);
  put('date', payload.createdAt);

  // Left alone entirely when the report has not run: a queued lead is not an
  // unqualified one, and writing "Not qualified" against it would be a lie
  // the customer acts on.
  if (payload.qualification.qualified !== null) {
    const col = config.columns.qualified;
    if (col) {
      const t = col.type.toLowerCase();
      const raw = CHECKBOX_TYPES.has(t)
        ? payload.qualification.qualified
        : payload.qualification.qualified
          ? config.qualifiedLabels.yes
          : config.qualifiedLabels.no;
      const formatted = formatColumnValue(col.type, raw);
      if (formatted !== undefined) values[col.id] = formatted;
    }
  }

  return values;
}
