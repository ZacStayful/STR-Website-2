/**
 * Batch 22, Part D2: the quiz's signals to the thinking background. Quiz.tsx
 * publishes; the canvas subscribes into refs, so an answer never re-renders it
 * per frame. Same numbers as the accuracy bar and the eye.
 *
 * Pure (a tiny external store): no network, no database.
 */
export interface ThinkingSignal {
  level: 0 | 1 | 2 | 3;
  /** Real answers given (not "Not sure"). */
  realAnswers: number;
  /** Real answers the next level needs in all, for the growth step; null at the top. */
  nextAt: number | null;
  /** Real answers the current level started at. */
  levelAt: number;
  /** Bumps on every real answer (a burst). */
  answerSeq: number;
  /** Bumps on every level reached (a wave), with the eye's power-up. */
  levelUpSeq: number;
}

let state: ThinkingSignal = { level: 0, realAnswers: 0, nextAt: null, levelAt: 0, answerSeq: 0, levelUpSeq: 0 };
const listeners = new Set<() => void>();

export function publishThinking(next: Partial<ThinkingSignal>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function readThinking(): ThinkingSignal {
  return state;
}

export function subscribeThinking(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Neurons at each level's start, desktop and phone (under 640px). Tuned after measuring. */
export const NEURONS: Record<0 | 1 | 2 | 3, { desktop: number; phone: number; links: number; pulseMs: number; opacity: number }> = {
  0: { desktop: 14, phone: 8, links: 1, pulseMs: 6000, opacity: 0.1 },
  1: { desktop: 40, phone: 20, links: 2, pulseMs: 2000, opacity: 0.15 },
  2: { desktop: 75, phone: 38, links: 3, pulseMs: 800, opacity: 0.2 },
  3: { desktop: 120, phone: 60, links: 3, pulseMs: 300, opacity: 0.25 },
};

/**
 * How many neurons show: the level's start, plus a step towards the next
 * level's for every real answer past the level's start. Only ever grows with
 * real answers; "Not sure" adds nothing.
 */
export function neuronCount(s: Pick<ThinkingSignal, 'level' | 'realAnswers' | 'nextAt' | 'levelAt'>, phone: boolean): number {
  const here = NEURONS[s.level][phone ? 'phone' : 'desktop'];
  if (s.level >= 3 || s.nextAt === null) return here;
  const next = NEURONS[(s.level + 1) as 1 | 2 | 3][phone ? 'phone' : 'desktop'];
  const span = Math.max(1, s.nextAt - s.levelAt);
  const done = Math.min(span, Math.max(0, s.realAnswers - s.levelAt));
  return Math.round(here + ((next - here) * done) / span);
}

/** A fixed seeded layout: neuron i is always in the same place, so growth only adds and a return shows the same network. */
export function neuronAt(i: number): { x: number; y: number } {
  const r = (n: number) => {
    const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(i * 2 + 1), y: r(i * 2 + 2) };
}
