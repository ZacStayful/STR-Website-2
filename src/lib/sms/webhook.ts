/**
 * The gate every Twilio webhook passes through: a form body signed with our
 * auth token, or nothing.
 *
 * Twilio signs the exact URL it was given (the one in the console, or the
 * StatusCallback we passed), so the check tries our public URL for this path
 * first and the URL the request arrived on second. Both are full HMAC checks.
 * No auth token configured means every webhook is refused (503, logged): an
 * unsigned request is never trusted, even to switch texts off.
 */
import { siteUrl } from '../url.ts';
import { twilioAuthToken } from './config.ts';
import { signatureValid } from './twilio.ts';

export type SignedForm = { ok: true; params: URLSearchParams } | { ok: false; response: Response };

export async function verifiedTwilioForm(request: Request): Promise<SignedForm> {
  const token = twilioAuthToken();
  if (!token) {
    console.error('[sms] webhook refused: TWILIO_AUTH_TOKEN is not set, so no signature can be checked');
    return { ok: false, response: new Response('Not configured', { status: 503 }) };
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/x-www-form-urlencoded')) {
    console.warn('[sms] webhook refused: not a form post');
    return { ok: false, response: new Response('Unsupported', { status: 415 }) };
  }
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const url = new URL(request.url);
  const candidates = [siteUrl(`${url.pathname}${url.search}`), request.url];
  if (!signatureValid(token, request.headers.get('x-twilio-signature'), candidates, params)) {
    console.warn(`[sms] webhook refused: missing or invalid X-Twilio-Signature on ${url.pathname}`);
    return { ok: false, response: new Response('Forbidden', { status: 403 }) };
  }
  return { ok: true, params };
}

/** A TwiML reply: an empty one sends nothing back; a message sends that text. */
export function twiml(message: string | null): Response {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = message ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(message)}</Message></Response>` : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}
