/**
 * The buy-to-let launch's one email line (Batch 28, Part I): "New:
 * buy-to-let deals" and an "Add Buy to let" button, inside the member's next
 * daily email (never an email of its own, so the one-a-day cap holds), once.
 * It starts at btl_launch_from (null: not yet) and goes only to a member none
 * of whose profiles has Buy to let ticked yet. profiles.btl_launch_line_at
 * records that it went.
 *
 * The button opens the profile's deal types with Buy to let ticked; the
 * member still confirms (/profile?add=btl). Existing "All" profiles are never
 * switched for them.
 *
 * Pure: no network, no database, no server-only.
 */
import type { MarketGoals } from '../market/goals.ts';
import type { Section } from '../notify/message.ts';

/** Where "Add Buy to let" goes: the profile, with Buy to let ticked and waiting for them to confirm. */
export const BTL_LAUNCH_PATH = '/profile?add=btl';

export const BTL_LAUNCH_LINE = 'New: buy-to-let deals. Homes to let to long-term tenants, judged on rent: the cash you put in, what it makes a month and your return.';

/** Whether any of the member's profiles already shows Buy to let. */
export function anyHasBtl(goals: readonly (Pick<MarketGoals, 'dealTypes'> | null | undefined)[]): boolean {
  return goals.some((g) => (g?.dealTypes ?? []).includes('btl'));
}

/** Whether the launch line is due for this member today: the launch has started, it never went, and they have no Buy to let yet. */
export function btlLaunchDue(input: { launchFrom: string | null; now: Date; lineAt: string | null; hasBtl: boolean }): boolean {
  if (!input.launchFrom || input.lineAt || input.hasBtl) return false;
  const from = Date.parse(input.launchFrom);
  return Number.isFinite(from) && input.now.getTime() >= from;
}

/** The line, as one section of the daily email. */
export function btlLaunchSection(siteUrl: string): Section {
  const base = siteUrl.replace(/\/$/, '');
  return {
    key: 'notice',
    title: null,
    blocks: [
      { type: 'text', text: BTL_LAUNCH_LINE, tone: 'callout' },
      { type: 'buttons', links: [{ label: 'Add Buy to let', url: `${base}${BTL_LAUNCH_PATH}` }] },
    ],
  };
}
