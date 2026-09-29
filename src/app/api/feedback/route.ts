import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { BRAND } from '@/lib/brand';
import { IMAGE, LIMITS, isReportKind } from '@/lib/feedback/config';
import { activityKey, cleanClientContext, cleanText, maxScreenshotBytes, screenshotProblem, sniffScreenshot, type ScreenshotType } from '@/lib/feedback/rules';
import { feedbackSettings } from '@/lib/feedback/settings-server';
import { sendAdminReportEmail, submitReport } from '@/lib/feedback/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * A member sends a bug report or an idea (Batch 18). Multipart form data:
 *   kind         bug | feature
 *   text         what they wrote (plain text)
 *   key          the form's own id for this send: a retry comes back as the
 *                same report, so a double tap or a lost reply never makes two
 *   context      JSON: the page, screen and so on (checked field by field)
 *   screenshots  up to billing_settings.feedback_max_screenshots images,
 *                already shrunk by the browser
 * Everything is checked before anything is written. The report is saved
 * with the service role; the member is the session's, never the request's.
 * The email to the admin address goes after the answer, and the daily
 * retention run retries it if it fails. Nothing is charged.
 */
function refuse(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > IMAGE.requestHardCapBytes) return refuse(413, 'too_large', 'That’s too much to send in one go. Please remove a screenshot and try again.');

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return refuse(401, 'signed_out', 'Please sign in again, then send it.');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, 'bad_request', 'We couldn’t read that. Please try again.');
  }

  const kind = form.get('kind');
  if (!isReportKind(kind)) return refuse(400, 'kind', 'Choose “Something’s broken” or “I have an idea”.');
  const text = cleanText(form.get('text'));
  if (!text.ok) return text.reason === 'empty' ? refuse(400, 'empty', 'Please write a few words first.') : refuse(400, 'too_long', `Please keep it under ${LIMITS.textMax.toLocaleString('en-GB')} characters.`);
  const key = String(form.get('key') ?? '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return refuse(400, 'bad_request', 'We couldn’t read that. Please try again.');
  const rawContext = String(form.get('context') ?? '');
  let client = cleanClientContext(null);
  if (rawContext.length > 0 && rawContext.length <= 4000) {
    try {
      client = cleanClientContext(JSON.parse(rawContext));
    } catch {
      /* no context: the report still goes */
    }
  }

  const settings = await feedbackSettings();
  const files = form.getAll('screenshots').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > settings.maxScreenshots) {
    return refuse(400, 'too_many', settings.maxScreenshots === 0 ? 'Screenshots can’t be sent just now. Please send the text on its own.' : `Up to ${settings.maxScreenshots} screenshots, please.`);
  }
  const images: { bytes: Uint8Array; type: ScreenshotType }[] = [];
  for (const file of files) {
    if (file.size > maxScreenshotBytes(settings)) return refuse(400, 'too_big', `Each screenshot has to be under ${settings.screenshotMaxMb} MB.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = screenshotProblem(bytes, settings);
    if (problem === 'too_big') return refuse(400, 'too_big', `Each screenshot has to be under ${settings.screenshotMaxMb} MB.`);
    if (problem) return refuse(400, 'not_an_image', 'Screenshots have to be JPG, PNG or WebP images.');
    images.push({ bytes, type: sniffScreenshot(bytes) as ScreenshotType });
  }

  const outcome = await submitReport({
    userId: user.id,
    email: user.email ?? null,
    kind,
    body: text.text,
    clientKey: key,
    client,
    userAgent: request.headers.get('user-agent'),
    files: images,
    settings,
  });
  if (!outcome.ok) {
    if (outcome.error === 'limit') return refuse(429, 'limit', `You’ve sent ${outcome.limit ?? settings.dailyLimit} today — the most we take in a day. Thank you! If it’s urgent, email ${BRAND.contactEmail}.`);
    if (outcome.error === 'unavailable') return refuse(503, 'unavailable', `Feedback isn’t switched on yet. Please email ${BRAND.contactEmail}.`);
    return refuse(500, 'failed', 'We couldn’t send that just now. Please try again.');
  }

  if (!outcome.duplicate) {
    logActivity(user.id, 'feedback_sent', { dedupeKey: activityKey.sent(outcome.id), extras: { kind, screenshots: outcome.attached } });
    const { id, failed } = outcome;
    after(async () => {
      const res = await sendAdminReportEmail(id, { failedImages: failed });
      if (!res.sent) console.warn(`[feedback] admin email for ${id} not sent (${res.reason ?? 'unknown'}); the daily run will retry it`);
    });
  }
  return Response.json({ ok: true, ref: outcome.ref, attached: outcome.attached, failed: outcome.failed });
}
