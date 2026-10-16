/**
 * Batch 27: when a live instruction (counting down or running) has been left
 * behind. Only the member's own card starts charged steps, so a page that
 * went away (closed, reloaded, a dropped stream) leaves its instruction
 * holding the one-at-a-time lock with nobody to start or stop it. Before a
 * new instruction is refused as busy, one left behind is closed: a countdown
 * nobody acted on expires (nothing charged ever ran), and queued steps
 * nobody started are skipped (what did start finishes through its own code).
 *
 * Pure: no network, no database, no server-only.
 */

/** The card asks for the first charged step the moment its countdown ends: still counting down this long after, nobody is there. */
export const ORPHAN_COUNTDOWN_MS = 60_000;
/** The card asks for the next step as soon as one starts or finishes: this long with nothing going on, nobody is there. */
export const PUMP_IDLE_MS = 2 * 60_000;
/** A charged step's start (its button's own call) takes seconds: still "running" after this, the process that claimed it died. */
export const STEP_STUCK_MS = 5 * 60_000;

export interface LiveInstruction {
  status: string;
  starts_after: string | null;
  charged_started_at: string | null;
  updated_at: string;
}

export interface LiveStep {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface LeftBehind {
  /** A countdown nobody acted on: expire it (nothing charged ran). */
  expire: boolean;
  /** Steps whose start never finished: failed, so the lock is freed. */
  abandon: string[];
  /** Queued steps nobody is going to start: skipped. */
  skipQueued: boolean;
}

const at = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
};

export function leftBehind(i: LiveInstruction, steps: readonly LiveStep[], now: Date): LeftBehind {
  const t = now.getTime();
  const none: LeftBehind = { expire: false, abandon: [], skipQueued: false };
  if (i.status === 'ready') {
    const startsAt = at(i.starts_after) || at(i.updated_at);
    return { ...none, expire: t - startsAt > ORPHAN_COUNTDOWN_MS };
  }
  if (i.status !== 'running') return none;
  const abandon = steps.filter((s) => s.status === 'running' && t - at(s.started_at) > STEP_STUCK_MS).map((s) => s.id);
  const going = steps.some((s) => s.status === 'handed_out' || (s.status === 'running' && !abandon.includes(s.id)));
  const queued = steps.some((s) => s.status === 'queued');
  const last = Math.max(at(i.charged_started_at), at(i.updated_at), ...steps.map((s) => Math.max(at(s.started_at), at(s.finished_at))));
  return { expire: false, abandon, skipQueued: queued && !going && t - last > PUMP_IDLE_MS };
}
