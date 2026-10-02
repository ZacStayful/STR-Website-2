/**
 * Batch 22f: the lead form setup's steps, and where someone arriving at
 * /leads/setup carries on from. Everything is saved as it goes (the funnel
 * is created on step 1 and saved on each step after), so a refresh, a closed
 * tab or a return from Stripe always lands on the first step not yet done.
 *
 * Pure: no network, no database, no server-only.
 */

export const SETUP_STEPS = [
  { step: 0, path: '/leads/setup', label: 'Starter pack' },
  { step: 1, path: '/leads/setup/company', label: 'Your company' },
  { step: 2, path: '/leads/setup/details', label: 'Your details' },
  { step: 3, path: '/leads/setup/delivery', label: 'Where leads go' },
] as const;

export const LIVE_PATH = '/leads/setup/live';

export type SetupStep = 0 | 1 | 2 | 3;

export interface SetupFacts {
  /** The starter pack can still be bought (and has not been put off with "Not now"). */
  packOffered: boolean;
  /** A funnel exists for the setup (its company name is required to create one). */
  hasFunnel: boolean;
  /** Step 2 has been saved (a reply-to address is set). */
  detailsSaved: boolean;
  /** Step 3 has been continued from. */
  deliveryDone: boolean;
  live: boolean;
}

/** The first step not yet done, or the finish. */
export function setupResume(f: SetupFacts): string {
  if (f.packOffered && !f.hasFunnel) return SETUP_STEPS[0].path;
  if (!f.hasFunnel) return SETUP_STEPS[1].path;
  if (!f.detailsSaved) return SETUP_STEPS[2].path;
  if (!f.deliveryDone && !f.live) return SETUP_STEPS[3].path;
  return LIVE_PATH;
}

/** The previous step's path, for Back. Step 1's back is the pack only while it is on offer. */
export function setupBack(step: SetupStep | 'live', packOffered: boolean): string | null {
  if (step === 'live') return SETUP_STEPS[3].path;
  if (step === 0) return null;
  if (step === 1) return packOffered ? `${SETUP_STEPS[0].path}?back=1` : null;
  return SETUP_STEPS[step - 1].path;
}

/** The eight swatches step 1 offers, plus "Custom". */
export const BRAND_SWATCHES: readonly string[] = ['#2E3D2B', '#1F5F8B', '#0F766E', '#7C3AED', '#B91C1C', '#C2410C', '#B45309', '#111827'];
