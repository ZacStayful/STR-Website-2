// Proxy to Google Places Autocomplete (New API). Keeps the API key server-side
// and biases results to the UK. Returns a trimmed shape so the client component
// doesn't have to know about Google's nested response format.
//
// Credit: Google bills one autocomplete SESSION (typing → selection) when the
// client passes a session token, so the member is charged once per session —
// the first request debits, later keystrokes in the same session log at £0.
// Signed-out callers are house spend (rate limited by IP as before).

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { startAction } from '@/lib/credit/action';
import { runMetered } from '@/lib/credit/context';
import { meter } from '@/lib/credit/meter';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { INSUFFICIENT_CREDIT_CODE } from '@/lib/credit/http';

// ─── Rate Limiter (in-memory, per IP) ────────────────────────────
// More generous than /api/analyse because autocomplete fires per keystroke:
// 60 requests per IP per 10-second window.
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 300_000);

// ─── Google Places response shape (partial) ──────────────────────
interface PlacePrediction {
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
}
interface AutocompleteResponse {
  suggestions?: Array<{ placePrediction?: PlacePrediction }>;
}

// ─── Trimmed client-facing shape ─────────────────────────────────
interface Suggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export async function GET(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return Response.json(
      { suggestions: [], error: 'Too many requests' },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const sessionToken = searchParams.get('session')?.trim() ?? '';

  // Client enforces a 3-char minimum but guard server-side too.
  if (q.length < 3) {
    return Response.json({ suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('[autocomplete] GOOGLE_PLACES_API_KEY not set');
    return Response.json(
      { suggestions: [], error: 'Address autocomplete is not configured' },
      { status: 500 },
    );
  }

  // Google Places Autocomplete (New API). Region-biased to GB.
  const body: Record<string, unknown> = {
    input: q,
    includedRegionCodes: ['gb'],
    languageCode: 'en-GB',
  };
  if (sessionToken) body.sessionToken = sessionToken;

  // Who pays: the signed-in member (once per session), else the house.
  let userId: string | null = null;
  let admin = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
    admin = isAdminEmail(data.user?.email);
  } catch {
    userId = null;
  }
  const sessionId = /^[0-9a-f-]{36}$/i.test(sessionToken) ? sessionToken : undefined;

  let action;
  try {
    action = await startAction({ userId, admin, action: 'autocomplete', oncePerAction: true, actionId: sessionId });
  } catch (err) {
    if (err instanceof InsufficientCreditError) return Response.json({ suggestions: [], code: INSUFFICIENT_CREDIT_CODE }, { status: 402 });
    throw err;
  }

  let upstream: Response;
  try {
    upstream = await runMetered(action.ctx, () =>
      meter({ provider: 'google', unit: 'autocomplete_session', key: sessionId, description: 'Address lookup', failed: (r) => !r.ok }, () =>
        fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask':
              'suggestions.placePrediction.placeId,' +
              'suggestions.placePrediction.text,' +
              'suggestions.placePrediction.structuredFormat',
          },
          body: JSON.stringify(body),
          cache: 'no-store',
        }),
      ),
    );
  } catch (err) {
    if (err instanceof InsufficientCreditError) return Response.json({ suggestions: [], code: INSUFFICIENT_CREDIT_CODE }, { status: 402 });
    console.error('[autocomplete] upstream fetch failed:', err);
    // Degrade gracefully — UI falls back to manual entry.
    return Response.json({ suggestions: [] });
  } finally {
    await action.finish().catch(() => {});
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '<unreadable>');
    console.error(
      `[autocomplete] Google Places returned HTTP ${upstream.status}: ${errText.slice(0, 300)}`,
    );
    return Response.json({ suggestions: [] });
  }

  const data = (await upstream.json()) as AutocompleteResponse;
  const suggestions: Suggestion[] = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is PlacePrediction => !!p && typeof p.placeId === 'string')
    .map((p) => ({
      placeId: p.placeId!,
      description: p.text?.text ?? '',
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }))
    .filter((s) => s.description.length > 0);

  return Response.json({ suggestions });
}
