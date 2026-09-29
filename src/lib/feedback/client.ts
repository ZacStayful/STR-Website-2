/**
 * Browser-side helpers for the feedback form (Batch 18). Any "Feedback"
 * button calls openFeedback(); the one FeedbackDialog on the page listens for
 * the event and opens, the same way openOutOfCredit() opens the credit modal
 * (src/lib/credit/client.ts). So the header, the footer and the quiz share
 * one form, and nothing has to wrap the page to reach it.
 */

export const FEEDBACK_EVENT = 'stayful:feedback';

export function openFeedback(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(FEEDBACK_EVENT));
}

/** What the form reports about where it was sent from (checked again on the server). */
export function captureContext(): Record<string, unknown> {
  const w = typeof window === 'undefined' ? null : window;
  if (!w) return {};
  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    /* not every browser says */
  }
  return {
    page: `${w.location.pathname}${w.location.search}`,
    screen: { w: w.screen?.width, h: w.screen?.height },
    viewport: { w: w.innerWidth, h: w.innerHeight },
    dpr: w.devicePixelRatio,
    touch: (w.navigator?.maxTouchPoints ?? 0) > 1,
    timeZone,
    language: w.navigator?.language ?? null,
    clientBuild: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
  };
}

/** A new id for one send: a retry of the same send reuses it, anything edited gets a new one. */
export function newClientKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
