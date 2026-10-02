/**
 * Batch 22e: the rates behind "Time saved" on Home, in one place (decided).
 * Batch 23b's briefing reads the same rates; nothing else defines them.
 *
 *   30 seconds for every property Stayful Intelligence screened for the member
 *   30 minutes for every full analysis they ran (an Analyser report, or a
 *   full analysis of a deal); quick looks add nothing
 *
 * Pure: no network, no database, no server-only.
 */
export const TIME_SAVED = {
  secondsPerPropertyScanned: 30,
  minutesPerFullAnalysis: 30,
} as const;

/** The line under the tile that says how the figure is worked out. */
export const TIME_SAVED_HOW = `${TIME_SAVED.secondsPerPropertyScanned} seconds for each property we screened for you, plus ${TIME_SAVED.minutesPerFullAnalysis} minutes for each full analysis you ran.`;

const count = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Minutes saved: 30s × scanned + 30 min × full analyses. Missing or bad inputs count as 0, so it is never NaN. */
export function timeSavedMinutes(scanned: number | null | undefined, fullAnalyses: number | null | undefined): number {
  return (count(scanned) * TIME_SAVED.secondsPerPropertyScanned) / 60 + count(fullAnalyses) * TIME_SAVED.minutesPerFullAnalysis;
}

/** "about 57 hours", "about 1 hour", "about 20 minutes"; null for nothing yet (the tile shows its zero state). */
export function aboutLabel(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 59.5) {
    const m = Math.max(1, Math.round(minutes));
    return `about ${m} minute${m === 1 ? '' : 's'}`;
  }
  const h = Math.round(minutes / 60);
  return `about ${h} hour${h === 1 ? '' : 's'}`;
}

/** The figure a tile counts up to for "about X hours": whole hours, or whole minutes under an hour. */
export function aboutFigure(minutes: number): { value: number; unit: 'hours' | 'minutes' } | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 59.5) return { value: Math.max(1, Math.round(minutes)), unit: 'minutes' };
  return { value: Math.round(minutes / 60), unit: 'hours' };
}
