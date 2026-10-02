/**
 * The budget-bracket panel on /admin/deals (Batch 22c, Part F): for each
 * budget a member gave, how many members, how many live deals match it,
 * what Today showed and they kept, and how many were weekly active; plus the
 * live deals at a cheap price this week against last.
 *
 * The figures reuse the weekly-active definition as it stands (Batch 21f,
 * src/lib/activity/metrics.ts): the same members (staff, admins and
 * excluded accounts left out), the same UK weeks (Monday to Sunday), the
 * same "active" (at least one qualifying action in the week) and the same
 * Today shown and kept counts (activity_weekly_facts' today block). Nothing
 * new is logged.
 *
 * Pure: no network, no database, no server-only.
 */
import { BUDGET_LABELS, type Budget } from '../market/filters.ts';
import { budgetBounds } from '../listing/sourcing.ts';

export type BracketKey = Exclude<Budget, 'any'> | 'none';

/** The panel's rows, lowest budget first; the legacy Under £200k beside the two it became. */
export const BRACKETS: readonly BracketKey[] = ['u100', '100-200', 'u200', '200-350', '350-500', '500+', 'none'];

export function bracketLabel(b: BracketKey): string {
  if (b === 'none') return 'No budget';
  if (b === 'u200') return `${BUDGET_LABELS.u200} (before Batch 22c)`;
  return BUDGET_LABELS[b];
}

/** A member's bracket: the short-let budget, else the project budget (a BRRR-only member), else none. */
export function bracketOf(goals: { budget?: Exclude<Budget, 'any'> | null; brrr?: { budget?: Exclude<Budget, 'any'> | null } | null } | null | undefined): BracketKey {
  return goals?.budget ?? goals?.brrr?.budget ?? 'none';
}

/** How many of `prices` (live purchases' asking prices) fall inside a bracket's bounds; every one for "No budget". */
export function dealsInBracket(prices: readonly number[], b: BracketKey): number {
  if (b === 'none') return prices.length;
  const { min, max } = budgetBounds(b);
  return prices.filter((p) => (min === null || p >= min) && (max === null || p <= max)).length;
}

export interface PanelMember {
  id: string;
  /** When they joined (ISO); a member is counted in a week only once they had joined by its end. */
  joined: string | null;
  bracket: BracketKey;
  /** Week start (YYYY-MM-DD) → active that week, from the weekly-active report. */
  active: ReadonlyMap<string, boolean>;
}

export interface WeekFigures {
  /** Members counted that week. */
  base: number;
  active: number;
  /** Today's deals shown and kept, per member counted. */
  shownPerMember: number | null;
  keptPerMember: number | null;
}

export interface PanelRow {
  bracket: BracketKey;
  label: string;
  members: number;
  liveDeals: number;
  lastWeek: WeekFigures;
  thisWeek: WeekFigures;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The week before `weekStart` (both YYYY-MM-DD). */
export function previousWeek(weekStart: string): string {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10);
}

function weekFigures(members: readonly PanelMember[], week: string, today: ReadonlyMap<string, { shown: number; kept: number }>): WeekFigures {
  const end = Date.parse(`${week}T00:00:00Z`) + 7 * DAY_MS;
  const counted = members.filter((m) => {
    const joined = m.joined ? Date.parse(m.joined) : Number.NaN;
    return !Number.isFinite(joined) || joined < end;
  });
  let shown = 0;
  let kept = 0;
  for (const m of counted) {
    const t = today.get(`${m.id}|${week}`);
    shown += t?.shown ?? 0;
    kept += t?.kept ?? 0;
  }
  return {
    base: counted.length,
    active: counted.filter((m) => m.active.get(week) === true).length,
    shownPerMember: counted.length > 0 ? round1(shown / counted.length) : null,
    keptPerMember: counted.length > 0 ? round1(kept / counted.length) : null,
  };
}

/**
 * The panel's rows. `today` holds the facts' Today block ({u, w, shown,
 * kept}); `prices` the live purchases' asking prices.
 */
export function budgetPanel(input: { members: readonly PanelMember[]; today: readonly { u: string; w: string; shown: number; kept: number }[]; prices: readonly number[]; thisWeek: string }): PanelRow[] {
  const today = new Map(input.today.map((t) => [`${t.u}|${String(t.w).slice(0, 10)}`, { shown: Number(t.shown) || 0, kept: Number(t.kept) || 0 }]));
  const last = previousWeek(input.thisWeek);
  return BRACKETS.map((bracket) => {
    const members = input.members.filter((m) => m.bracket === bracket);
    return {
      bracket,
      label: bracketLabel(bracket),
      members: members.length,
      liveDeals: dealsInBracket(input.prices, bracket),
      lastWeek: weekFigures(members, last, today),
      thisWeek: weekFigures(members, input.thisWeek, today),
    };
  }).filter((r) => r.members > 0 || r.bracket !== 'u200');
}

/** Cheap live deals: how many now, and how many went live in the last 7 days against the 7 before. */
export interface CheapCounts {
  liveNow: number;
  wentLiveThisWeek: number;
  wentLiveLastWeek: number;
}

export function cheapCounts(rows: readonly { status: string; price: number | null; liveSince: string | null }[], cheapMaxPrice: number, now: Date): CheapCounts {
  const t = now.getTime();
  const cheap = rows.filter((r) => r.price !== null && r.price > 0 && r.price <= cheapMaxPrice);
  const since = (r: { liveSince: string | null }) => (r.liveSince ? Date.parse(r.liveSince) : Number.NaN);
  return {
    liveNow: cheap.filter((r) => r.status === 'live').length,
    wentLiveThisWeek: cheap.filter((r) => t - since(r) >= 0 && t - since(r) < 7 * DAY_MS).length,
    wentLiveLastWeek: cheap.filter((r) => t - since(r) >= 7 * DAY_MS && t - since(r) < 14 * DAY_MS).length,
  };
}
