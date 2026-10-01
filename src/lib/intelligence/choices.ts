/**
 * Batch 22, Part C: the words of the notification choices (the welcome screen
 * and the Notifications panel's Calls section). Every price from settings.
 *
 * Pure: no network, no database, no server-only.
 */
import { formatPence } from '../credit/deal-pricing.ts';

export function callPriceLine(s: { siCallPencePerMin: number; siTextPence: number; siEmailPence: number }): string {
  return `A short intro call, calls about standout deals, and calls when your credit is low. About ${formatPence(s.siCallPencePerMin)} a minute from your credit; missed calls are free.`;
}

/** The longer note under the call box on the welcome screen. */
export function callBoxNote(s: { siCallPencePerMin: number; siTextPence: number; siEmailPence: number }): string {
  return `That covers a short call to introduce myself, calls about standout deals and calls when your credit is low. Calls cost about ${formatPence(s.siCallPencePerMin)} a minute from your credit; missed calls are free. Texts ${formatPence(s.siTextPence)}, emails ${formatPence(s.siEmailPence)}. Switch calls off any time in Account → Notifications.`;
}

export const CALL_BOX_LABEL = 'Call me when a deal as good as this one comes up, or when I’m running low on credit.';
