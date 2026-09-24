import { parseAnalysisInput } from '@/lib/analysis/input';
import { reserveAnalysis, runAnalysis, GeocodeError } from '@/lib/analysis/run';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { getBalance } from '@/lib/credit/ledger';
import { getUnitCostTable, getBillingSettings } from '@/lib/credit/unit-costs';
import { estimateAction, reportAction } from '@/lib/credit/estimate';
import { ownedFunnelByToken } from '@/lib/funnels';
import { countAttempt, reserveSpend, settleSpend, capMessage } from '@/lib/funnels/caps';
import { raiseFunnelAlert } from '@/lib/funnels/alerts';
import { captureLead, completeLead } from '@/lib/leads/store';
import { isDisposableEmail } from '@/lib/credit/abuse';
import { verifyTurnstile } from '@/lib/turnstile/verify';

/**
 * A prospect completing someone's white-label funnel.
 *
 * Public: no session, no account, and the person submitting is not the
 * person paying. The funnel's OWNER is charged, which makes this the one
 * endpoint in the codebase where a stranger's request spends a customer's
 * money — so the order of the guards below is the whole design, and none of
 * them may be skipped:
 *
 *   1. the funnel must exist and be live
 *   2. Turnstile says a person submitted this, BEFORE the caps are counted
 *      so bot traffic cannot exhaust the customer's daily lead allowance
 *   3. the attempt is counted against the per-IP and daily caps, atomically
 *   4. the lead is captured BEFORE anything is spent, so a dry balance
 *      costs the customer an enquiry they never see
 *   5. solvency is checked explicitly, never through isEnforcing() — shadow
 *      mode is a safety net for members, not permission to spend here
 *   6. the day's spend ceiling is claimed at the run's worst case, then
 *      reconciled to the actual afterwards
 *
 * Short of credit at 5 or 6, the lead stays `queued` and nothing is spent.
 */

export const maxDuration = 60;

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** A one-event stream, for refusals that happen before any work starts. */
function sseOnce(data: Record<string, unknown>): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse(data)));
        controller.close();
      },
    }),
    { headers: SSE_HEADERS },
  );
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

const QUEUED_MESSAGE =
  'Thanks — your report is being prepared and will be sent to you shortly.';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // ── 1. The funnel ──
  const funnel = await ownedFunnelByToken(token);
  if (!funnel) return new Response('Not found', { status: 404 });

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return sseOnce({ stage: 'error', progress: 0, message: 'We could not read that submission. Please try again.' });
  }

  // ── 2. Turnstile, BEFORE the caps are counted. ──
  //
  // The ordering is the point. countAttempt deliberately counts refused
  // attempts too, so a flood shows up afterwards rather than being
  // invisible — which means a bot that got as far as the cap would burn the
  // customer's daily lead allowance on its way to being rejected, denying
  // service to the real prospects the funnel exists for. Turning bots away
  // first keeps the allowance for people.
  //
  // A no-op until the keys are set, and open if Cloudflare cannot be
  // reached; see src/lib/turnstile/verdict.ts for why that is safe here.
  const turnstileToken = (body && typeof body === 'object' ? (body as Record<string, unknown>).turnstileToken : null);
  const human = await verifyTurnstile(typeof turnstileToken === 'string' ? turnstileToken : null, ip);
  if (!human.allow) {
    return sseOnce({ stage: 'error', progress: 0, message: human.message });
  }

  // ── 3. Caps, counted atomically. A read-then-check would let concurrent
  //      submissions all pass; see src/lib/funnels/caps.ts. ──
  const verdict = await countAttempt(funnel.id, ip, funnel.dailyCap);
  if (verdict !== 'ok') {
    // Only the genuine daily cap is worth telling the owner about: an IP
    // throttle is one visitor being impatient, and 'unavailable' is our end
    // failing rather than a limit of theirs.
    if (verdict === 'daily_cap') await raiseFunnelAlert('daily_cap', funnel);
    return sseOnce({ stage: 'error', progress: 0, message: capMessage(verdict) });
  }

  const parsed = parseAnalysisInput(body);
  if (!parsed.ok) return sseOnce({ stage: 'error', progress: 0, message: parsed.error });
  const input = parsed.input;

  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

  // The customer is the data controller; without consent there is no lawful
  // basis to keep any of this, so nothing is written at all.
  if (b.consent !== true) {
    return sseOnce({ stage: 'error', progress: 0, message: 'Please confirm you are happy to be contacted before continuing.' });
  }
  if (isDisposableEmail(input.email)) {
    return sseOnce({ stage: 'error', progress: 0, message: 'Please use a permanent email address so your report can reach you.' });
  }

  // The depth is the funnel owner's choice, never the prospect's.
  const wantEnhanced = funnel.reportDepth === 'enhanced';
  const runInput = { ...input, enhancedRequested: wantEnhanced };

  // ── 4. Capture first. An enquiry costs nothing to keep, and losing a real
  //      prospect because a balance ran dry is the outcome worth designing
  //      against. ──
  const leadId = await captureLead({
    userId: funnel.userId,
    funnelId: funnel.id,
    contact: {
      name: str(b.name, 120),
      email: input.email,
      phone: str(b.phone, 40),
      consentAt: new Date().toISOString(),
    },
    property: {
      address: input.property.address,
      postcode: input.property.postcode,
      bedrooms: input.property.bedrooms,
    },
    status: 'queued',
  });
  if (!leadId) {
    return sseOnce({ stage: 'error', progress: 0, message: 'We could not start your report just now. Please try again shortly.' });
  }

  const settings = await getBillingSettings();
  const markupOverride = settings.funnelMarkup;
  const estimate = estimateAction(await getUnitCostTable(), reportAction(wantEnhanced), { markupOverride });

  // ── 5. Solvency, explicitly. Deliberately NOT isEnforcing(). ──
  const balance = await getBalance(funnel.userId).catch(() => null);
  if (!balance || balance.spendableBasePence < estimate.maxBasePence) {
    // The enquiry is already captured, so nothing is lost — but the prospect
    // has just been promised a report that will not arrive until the owner
    // tops up, and until now nothing told them that was happening.
    await raiseFunnelAlert('out_of_credit', funnel);
    return sseOnce({ stage: 'queued', progress: 100, message: QUEUED_MESSAGE });
  }

  // ── 6. Claim today's spend headroom at the worst case. ──
  const claimed = await reserveSpend(funnel.id, estimate.maxBasePence, funnel.dailySpendCapPence);
  if (!claimed) {
    await raiseFunnelAlert('spend_cap', funnel);
    return sseOnce({ stage: 'queued', progress: 100, message: QUEUED_MESSAGE });
  }

  let prepared;
  try {
    prepared = await reserveAnalysis(runInput, {
      billedUserId: funnel.userId,
      markupOverride,
      requireCredit: true,
      funnelId: funnel.id,
    });
  } catch (err) {
    await settleSpend(funnel.id, estimate.maxBasePence, 0);
    if (err instanceof InsufficientCreditError) {
      return sseOnce({ stage: 'queued', progress: 100, message: QUEUED_MESSAGE });
    }
    throw err;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(sse(data)));
      };
      let actualBasePence = 0;
      try {
        const { result, spend } = await runAnalysis(prepared, runInput, {
          billedUserId: funnel.userId,
          markupOverride,
          requireCredit: true,
          onProgress: (e) => send({ stage: e.stage, progress: e.progress, message: e.message }),
        });
        actualBasePence = spend.basePence;

        // Null means the report could not be attached to the lead. The run
        // itself succeeded and has been paid for, so the prospect below still
        // gets it — but the customer's copy is gone, and completeLead has
        // already done what it can to stop the drain running it again. Said
        // here so the loss is visible in this request's logs and not only in
        // the library's.
        const attached = await completeLead({
          leadId,
          result,
          rules: funnel.leadRules,
          unqualifiedPolicy: funnel.unqualifiedPolicy,
        });
        if (!attached) {
          console.error(`[funnel] lead ${leadId} ran and was charged but its report could not be saved`);
        }

        // The prospect is never shown the qualification verdict or anything
        // about the customer's credit — that is the customer's business.
        send({ stage: 'complete', progress: 100, message: 'Analysis complete', data: result });
      } catch (err) {
        if (err instanceof GeocodeError) {
          send({ stage: 'error', progress: 0, message: err.message });
        } else {
          console.error('[funnel] analysis failed:', err);
          send({ stage: 'error', progress: 0, message: 'We could not finish your report just now. Please try again shortly.' });
        }
      } finally {
        // Hand back whatever the worst case over-claimed, so one run cannot
        // lock out the rest of the customer's day.
        await settleSpend(funnel.id, estimate.maxBasePence, actualBasePence).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
