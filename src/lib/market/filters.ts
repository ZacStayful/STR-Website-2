/** Filter vocab shared by the explorer's filter bar and the goal profile. */

/**
 * Batch 22c: 'Under £200k' became two brackets, 'u100' (under £100k) and
 * '100-200' (£100k–£200k). 'u200' stays a valid stored value meaning "under
 * £200k" for the members who chose it before, labelled as it always was,
 * but is never offered again (BUDGET_CHOICES).
 */
export type Budget = 'any' | 'u100' | '100-200' | 'u200' | '200-350' | '350-500' | '500+';
export type Beds = 'any' | '1' | '2' | '3' | '4+';
export type Region = 'any' | 'England' | 'Scotland' | 'Wales' | 'Northern Ireland';
export type Conf = 'any' | 'confirmed' | 'building+';

export const BUDGET_LABELS: Record<Budget, string> = {
  any: 'Any budget',
  u100: 'Under £100k',
  '100-200': '£100k–£200k',
  u200: 'Under £200k',
  '200-350': '£200k–£350k',
  '350-500': '£350k–£500k',
  '500+': '£500k+',
};

/** The purchase budgets a member is offered, lowest first (Batch 22c). Never the legacy 'u200'. */
export const BUDGET_CHOICES = ['u100', '100-200', '200-350', '350-500', '500+'] as const satisfies readonly Exclude<Budget, 'any' | 'u200'>[];

/** A budget filter's choices: any, then BUDGET_CHOICES; a legacy 'u200' already chosen (an old link) stays listed so it still reads. */
export function budgetFilterOptions(current: Budget): Budget[] {
  return ['any', ...BUDGET_CHOICES, ...(current === 'u200' ? (['u200'] as const) : [])];
}

/** A budget search only surfaces areas whose value we can confirm fits. */
export function inBudget(valueMid: number | null, b: Budget): boolean {
  if (b === 'any') return true;
  if (valueMid === null) return false;
  if (b === 'u100') return valueMid < 100_000;
  if (b === '100-200') return valueMid >= 100_000 && valueMid < 200_000;
  if (b === 'u200') return valueMid < 200_000;
  if (b === '200-350') return valueMid >= 200_000 && valueMid < 350_000;
  if (b === '350-500') return valueMid >= 350_000 && valueMid < 500_000;
  return valueMid >= 500_000;
}

export function hasBeds(available: number[], b: Beds): boolean {
  if (b === 'any') return true;
  if (b === '4+') return available.some((n) => n >= 4);
  return available.includes(Number(b));
}

export function passesConfidence(tier: string, c: Conf): boolean {
  if (c === 'any') return true;
  if (c === 'confirmed') return tier === 'confirmed';
  return tier === 'confirmed' || tier === 'building';
}

export function isBudget(v: unknown): v is Budget {
  return v === 'any' || v === 'u100' || v === '100-200' || v === 'u200' || v === '200-350' || v === '350-500' || v === '500+';
}
export function isBeds(v: unknown): v is Beds {
  return v === 'any' || v === '1' || v === '2' || v === '3' || v === '4+';
}
export function isRegion(v: unknown): v is Region {
  return v === 'any' || v === 'England' || v === 'Scotland' || v === 'Wales' || v === 'Northern Ireland';
}
export function isConf(v: unknown): v is Conf {
  return v === 'any' || v === 'confirmed' || v === 'building+';
}
