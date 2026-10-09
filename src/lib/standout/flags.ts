/**
 * Batch 25's two switches, both off until tested:
 *   STANDOUT_ENABLED        the standout pass saves deals (otherwise it only judges)
 *   STANDOUT_CALLS_ENABLED  deal calls, and the texts and emails in their place
 * Batch 23's SI_CALLS_ENABLED still gates every call.
 *
 * Pure.
 */
export function standoutEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STANDOUT_ENABLED === 'true';
}

export function dealCallsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STANDOUT_CALLS_ENABLED === 'true';
}
