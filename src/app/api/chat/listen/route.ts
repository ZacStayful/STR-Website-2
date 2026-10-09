import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { isSameOrigin } from '@/lib/tracking/request';
import { SeatPausedError, startAction } from '@/lib/credit/action';
import { runMetered } from '@/lib/credit/context';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { insufficientCreditResponse } from '@/lib/credit/http';
import { meter } from '@/lib/credit/meter';
import { chatOn, readChatSettings, voiceOn } from '@/lib/chat/turns-server';
import { MAX_QUESTION_CHARS, STT_LANGUAGE, STT_MODEL, STT_TIMEOUT_MS, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from '@/lib/chat/config';

/**
 * Batch 26b: a spoken question to Stayful Intelligence, turned into text
 * (ElevenLabs speech-to-text, Scribe). The page then sends that text as an
 * ordinary question, so every rule, look-up and charge of the typed chat
 * applies unchanged.
 *
 * Signed-in members only, with the chat and its voice switched on. Charged
 * like the narrator's voice (/api/speak): the "speak" action ("AI voice"),
 * metered per second of audio; nothing is charged when the service fails or
 * hears nothing. vercel.json opts this route into request cancellation, so a
 * page that goes away stops the call.
 *
 * Body: multipart form with `audio` (the recording, at most VOICE_MAX_BYTES)
 * and `seconds` (its length, as the page measured it). Returns { text }.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

function extensionFor(type: string): string {
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  return 'webm';
}

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers) || !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in to talk to Stayful Intelligence.', code: 'signed_out' }, { status: 401 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const settings = await readChatSettings();
  if (!apiKey || !chatOn(settings) || !voiceOn(settings)) return Response.json({ error: 'Voice isn’t switched on just now.', code: 'off' }, { status: 403 });

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > VOICE_MAX_BYTES + 64_000) return Response.json({ error: 'That recording is too long.', code: 'too_long' }, { status: 413 });
  let audio: Blob;
  let seconds: number;
  try {
    const form = await request.formData();
    const file = form.get('audio');
    if (!(file instanceof Blob) || file.size === 0) throw new Error('no audio');
    audio = file;
    const s = Number(form.get('seconds'));
    seconds = Math.min(VOICE_MAX_SECONDS, Math.max(1, Math.ceil(Number.isFinite(s) ? s : VOICE_MAX_SECONDS)));
  } catch {
    return Response.json({ error: 'No recording came through.' }, { status: 400 });
  }
  if (audio.size > VOICE_MAX_BYTES) return Response.json({ error: 'That recording is too long.', code: 'too_long' }, { status: 413 });

  let action;
  try {
    action = await startAction({ userId: user.id, admin: isAdminEmail(user.email), action: 'speak' });
  } catch (err) {
    if (err instanceof SeatPausedError) return Response.json({ error: 'Your seat is paused. Ask your team owner.', code: 'seat_paused' }, { status: 403 });
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(err, 'speak');
    throw err;
  }

  let heard: { ok: boolean; text: string };
  try {
    heard = await runMetered(action.ctx, () =>
      meter(
        // Not charged when the service fails or hears nothing (failed → logged at £0).
        { provider: 'elevenlabs', unit: 'stt_second', quantity: seconds, description: 'Stayful Intelligence listening', failed: (r: { ok: boolean; text: string }) => !r.ok || !r.text },
        async () => {
          const body = new FormData();
          body.append('model_id', STT_MODEL);
          body.append('language_code', STT_LANGUAGE);
          body.append('tag_audio_events', 'false');
          body.append('file', audio, `question.${extensionFor(audio.type)}`);
          const res = await fetch(STT_URL, {
            method: 'POST',
            headers: { 'xi-api-key': apiKey },
            body,
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(STT_TIMEOUT_MS)]),
          });
          if (!res.ok) {
            console.error('[api/chat/listen] ElevenLabs error', res.status, (await res.text().catch(() => '')).slice(0, 300));
            return { ok: false, text: '' };
          }
          const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
          return { ok: true, text: typeof json?.text === 'string' ? json.text.trim() : '' };
        },
      ),
    );
  } catch (err) {
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(err, 'speak');
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('[api/chat/listen] failed:', (err as Error)?.message ?? err);
    return Response.json({ error: 'I couldn’t hear that. Try again, or type it.' }, { status: 502 });
  } finally {
    await action.finish().catch(() => {});
  }

  if (!heard.ok) return Response.json({ error: 'I couldn’t hear that. Try again, or type it.' }, { status: 502 });
  return Response.json({ text: heard.text.slice(0, MAX_QUESTION_CHARS) });
}
