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
import { ownedFunnelByToken } from '@/lib/funnels';
import { countAutocomplete, reserveSpend, settleSpend } from '@/lib/funnels/caps';
import { actionSpend } from '@/lib/credit/action';
import { estimateAction } from '@/lib/credit/estimate';
import { getBillingSettings, getUnitCostTable } from '@/lib/credit/unit-costs';

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

  // Who pays: the signed-in member (once per session); on a white-label
  // funnel, the funnel's OWNER; otherwise the house.
  //
  // Without the funnel branch an anonymous caller is house spend by design,
  // which is right for a stray visitor but wrong for a funnel: every lead
  // that types an address would put a few pence on our bill instead of the
  // customer's, on a page the customer is monetising.
  let userId: string | null = null;
  let admin = false;
  let markupOverride: number | undefined;
  let funnelId: string | null = null;
  // What the funnel branch has claimed of the day's spend ceiling, so the
  // `finally` below can hand back whatever the lookup did not actually cost.
  let spendGuard: { funnelId: string; reservedPence: number } | null = null;
  const funnelToken = searchParams.get('f');
  if (funnelToken) {
    const funnel = await ownedFunnelByToken(funnelToken);
    // An unknown or paused token bills nobody rather than falling back to
    // the house: a dead token must not be a way to spend our money.
    if (!funnel) return Response.json({ suggestions: [] });

    // This is the second endpoint in the codebase where a stranger's request
    // spends a customer's money, and the only limit used to be the in-memory
    // counter above — which resets on every cold start and multiplies by
    // however many instances are warm. Anyone holding a funnel link could
    // therefore drain the owner's balance a few pence at a time, past the
    // daily ceiling they had set, because nothing here looked at it.
    //
    // Both guards below fail closed and both degrade to an empty list rather
    // than an error: the address field falls back to manual entry, so a
    // refused lookup costs the prospect a little typing and not their enquiry.
    if (!(await countAutocomplete(funnel.id, ip))) return Response.json({ suggestions: [] });

    markupOverride = (await getBillingSettings()).funnelMarkup;
    // Claimed against the SAME daily ceiling an analysis is claimed against,
    // so a customer's £50 means £50 across everything their funnel spends,
    // and settled to the real figure afterwards — a session that dedupes to
    // £0 must not leave a hold on the day. A non-positive cap reads as "no
    // limit" in SQL, which is the wrong direction for a money guard, so fall
    // back to the column default rather than letting a zero switch it off.
    const capPence = funnel.dailySpendCapPence > 0 ? funnel.dailySpendCapPence : 5000;
    const estimate = estimateAction(await getUnitCostTable(), 'autocomplete', { markupOverride });
    if (!(await reserveSpend(funnel.id, estimate.maxBasePence, capPence))) {
      return Response.json({ suggestions: [] });
    }
    spendGuard = { funnelId: funnel.id, reservedPence: estimate.maxBasePence };

    userId = funnel.userId;
    funnelId = funnel.id;
  } else {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
      admin = isAdminEmail(data.user?.email);
    } catch {
      userId = null;
    }
  }
  const sessionId = /^[0-9a-f-]{36}$/i.test(sessionToken) ? sessionToken : undefined;

  /**
   * Hands back what this lookup claimed of the day's spend ceiling, minus what
   * it actually cost. Every exit below has to go through here: nothing expires
   * a funnel's spend row, so a claim left behind sits on the customer's ceiling
   * until UTC midnight. The 402 below is the likeliest exit of all — the funnel
   * branch sets `requireCredit`, so an owner who has run out of credit reaches
   * it on every keystroke.
   */
  const releaseSpendGuard = async (actualBasePence: number) => {
    if (!spendGuard) return;
    const claimed = spendGuard;
    spendGuard = null;
    await settleSpend(claimed.funnelId, claimed.reservedPence, actualBasePence).catch(() => {});
  };

  let action;
  try {
    action = await startAction({ userId, admin, action: 'autocomplete', oncePerAction: true, actionId: sessionId, markupOverride, requireCredit: Boolean(funnelToken), funnelId });
  } catch (err) {
    // Nothing ran, so nothing was spent.
    await releaseSpendGuard(0);
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
    if (spendGuard) {
      // Read after `finish`, so the debit this lookup made (if any — a repeat
      // keystroke in the same session logs £0) is already recorded.
      const spent = await actionSpend(action.ctx.actionId).catch(() => ({ basePence: 0 }));
      await releaseSpendGuard(spent.basePence);
    }
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
