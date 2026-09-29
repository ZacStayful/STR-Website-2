/**
 * A Project deal on every surface that prints a range (Part F): the card
 * view, the email and list lines, the area blocks and the share page all
 * come here, so a Project deal reads the same everywhere:
 *
 *   £550–£750/mo after works · based on 12 similar Airbnbs nearby ·
 *   £22k value added · Works ~£14k–£26k · £45k–£58k cash in
 *
 * Numbers only, from the card-safe marketplace_deals.project: never a
 * line, a reason, a photo or a place. The profit after works is worked out
 * at the viewer's finance (the house figures without them), on the deal's
 * own income, like every other range.
 *
 * Kept apart from profit-range.ts, which headline.ts already imports.
 *
 * Pure: no network, no database, no server-only.
 */
import { cardRangeLine, type ProfitRangeInput } from '../marketplace/profit-range.ts';
import { parseProjectCard, PROJECT_BADGE, projectNumbers, type ProjectCardData, type ProjectNumbers } from './headline.ts';

/** The card's Project numbers when it is a Project deal (a sale carrying a usable `project`), else null. */
export function projectOf(card: { kind: string; project?: unknown }): ProjectCardData | null {
  if (card.kind !== 'sale' || card.project === undefined || card.project === null) return null;
  return parseProjectCard(card.project);
}

type IncomeFields = { screening_gross?: number | string | null; screening_confidence?: string | null; check_comps?: number | string | null };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** The card's three Project numbers, the profit after works at this finance. */
export function projectNumbersFor(card: IncomeFields, project: ProjectCardData, finance: ProfitRangeInput['finance'], widths: ProfitRangeInput['widths']): ProjectNumbers {
  return projectNumbers(project, { grossRevenue: num(card.screening_gross), confidence: card.screening_confidence ?? null, compCount: card.check_comps ?? null }, finance, widths);
}

/** "Works ~£14k–£26k · £22k value added": the card's second line. */
export function projectSummary(n: Pick<ProjectNumbers, 'works' | 'valueAdded'>): string {
  return `${n.works} · ${n.valueAdded}`;
}

/**
 * One line, profit first: "£550–£750/mo after works · based on 12 similar
 * Airbnbs nearby · £22k value added · Works ~£14k–£26k · £45k–£58k cash in".
 * The first two parts are the range and its caption, as on every other
 * deal's line (the welcome page splits it on " · ").
 */
export function projectRangeLine(n: ProjectNumbers): string {
  return [n.profit, n.profit ? n.caption : null, n.valueAdded, n.works, n.cash].filter((x): x is string => Boolean(x)).join(' · ');
}

type LineCard = Parameters<typeof cardRangeLine>[0] & { project?: unknown };

/** Every email and list line: a Project deal's own numbers, else the ordinary range line. */
export function rangeLineFor(card: LineCard, finance: ProfitRangeInput['finance'], widths: ProfitRangeInput['widths']): string | null {
  const project = projectOf(card);
  if (!project) return cardRangeLine(card, finance, widths);
  return projectRangeLine(projectNumbersFor(card, project, finance, widths));
}

/** The kind word on a card, a teaser or a share: "Project", "Rent-to-rent" or "To buy". */
export function kindWordFor(card: { kind: string; project?: unknown }): string {
  if (card.kind === 'rent') return 'Rent-to-rent';
  return projectOf(card) ? PROJECT_BADGE : 'To buy';
}
