/**
 * Batch 23b: the admin briefings page's figures, per UK day, from
 * member_briefings rows.
 *
 *   generated      written by the AI and passed the validator (charged)
 *   rejected       written by the AI, failed the validator or came back
 *                  unusable: the template went instead (not charged)
 *   template only  never sent to the AI (switch off, low credit, no writer)
 *   skipped        nothing new to say (no angle that was not yesterday's)
 *
 * Pure: no network, no database, no server-only.
 */

export interface BriefingRowLite {
  uk_day: string;
  status: string;
  ai_attempted: boolean;
  shown_in_app_at: string | null;
  seen_email_at: string | null;
  played_count: number;
  feedback: string | null;
  charge_pence: number | string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface BriefingDay {
  day: string;
  generated: number;
  rejected: number;
  templateOnly: number;
  skipped: number;
  seenInApp: number;
  seenByEmail: number;
  played: number;
  useful: number;
  notForMe: number;
  /** Base pence charged. */
  chargedPence: number;
}

export function summariseDays(rows: readonly BriefingRowLite[]): BriefingDay[] {
  const days = new Map<string, BriefingDay>();
  for (const r of rows) {
    const d = days.get(r.uk_day) ?? { day: r.uk_day, generated: 0, rejected: 0, templateOnly: 0, skipped: 0, seenInApp: 0, seenByEmail: 0, played: 0, useful: 0, notForMe: 0, chargedPence: 0 };
    if (r.status === 'ready') d.generated += 1;
    else if (r.status === 'template' && r.ai_attempted) d.rejected += 1;
    else if (r.status === 'template') d.templateOnly += 1;
    else if (r.status === 'skipped') d.skipped += 1;
    if (r.shown_in_app_at) d.seenInApp += 1;
    if (r.seen_email_at) d.seenByEmail += 1;
    if ((Number(r.played_count) || 0) > 0) d.played += 1;
    if (r.feedback === 'useful') d.useful += 1;
    if (r.feedback === 'not_for_me') d.notForMe += 1;
    d.chargedPence += Number(r.charge_pence) || 0;
    days.set(r.uk_day, d);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}
