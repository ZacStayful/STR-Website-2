import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { isSendToken, SWITCHES_BEHIND } from '@/lib/notify/cap';
import { sendByToken } from '@/lib/notify/sends';
import { notificationType } from '@/lib/notifications/registry';
import { setNotification } from '@/lib/notifications/server';
import { escapeHtml as esc } from '@/lib/email/escape';
import { manageNotificationsUrl } from '@/lib/url';

export const runtime = 'nodejs';

/**
 * Unsubscribe from one Batch 6 email (the daily digest, Your week), keyed by
 * the token that email carried (notification_sends.unsubscribe_token). It
 * turns off every switch behind that email (SWITCHES_BEHIND) through the one
 * notifications writer, so the panel shows the change at once.
 *
 * RFC 8058: mail clients POST here with `List-Unsubscribe=One-Click` and get
 * a plain 200. A browser GET only shows a confirm button, because mail
 * security scanners prefetch links and a GET must never have side effects;
 * the button POSTs back here and gets a page saying it is done.
 */

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#2e3d2b;max-width:520px;margin:48px auto;padding:0 20px;line-height:1.55">
<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">Stayful</p>
<h1 style="font-size:22px">${esc(title)}</h1>${body}
<p style="margin-top:28px;font-size:14px"><a href="${esc(manageNotificationsUrl())}" style="color:#5d8156">Manage every notification</a></p>
</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function lookUp(token: string) {
  if (!isSendToken(token) || !hasServiceRole()) return null;
  return sendByToken(createAdminClient(), token);
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const send = await lookUp(token);
  if (!send) return page('Link not recognised', '<p>This unsubscribe link has expired or is not valid. You can change every email from your notifications page.</p>', 404);
  const labels = SWITCHES_BEHIND[send.kind].map((k) => notificationType(k).label);
  return page(
    'Stop these emails?',
    `<p>This turns off: <strong>${esc(labels.join(', '))}</strong>.</p><form method="post"><button type="submit" style="background:#5d8156;color:#fff;border:0;border-radius:999px;padding:10px 20px;font-weight:600;font-size:15px;cursor:pointer">Turn off</button></form>`,
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const oneClick = (await request.text().catch(() => '')).includes('List-Unsubscribe=One-Click');
  const send = await lookUp(token);
  if (!send) return oneClick ? new Response('Not found', { status: 404 }) : page('Link not recognised', '<p>This unsubscribe link has expired or is not valid.</p>', 404);
  const keys = SWITCHES_BEHIND[send.kind];
  const results = await Promise.all(keys.map((k) => setNotification(send.userId, k, false)));
  const ok = results.every(Boolean);
  if (oneClick) return new Response(ok ? 'Unsubscribed' : 'Try again later', { status: ok ? 200 : 503, headers: { 'Content-Type': 'text/plain' } });
  if (!ok) return page('Something went wrong', '<p>We could not save that just now. Please try again, or use your notifications page.</p>', 503);
  const labels = keys.map((k) => notificationType(k).label);
  return page('Done', `<p>Turned off: <strong>${esc(labels.join(', '))}</strong>. You can turn them back on any time.</p>`);
}
