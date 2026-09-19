import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { parseAnalysisInput } from '@/lib/analysis/input';
import { reserveAnalysis, runAnalysis, GeocodeError } from '@/lib/analysis/run';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { saveApiReport } from '@/lib/api/reports-write';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Run an analysis. JSON in, JSON out — no SSE.
 *
 * The browser's analyser streams because a person is watching a progress
 * bar for thirty seconds. An agent is not: it wants one request and one
 * answer, and making it parse an event stream to get there would be a worse
 * interface for no benefit. `onProgress` is simply not passed.
 *
 * This is the one v1 route that spends money, which is why it is its own
 * scope. A customer handing an agent a key without `analyse` gets something
 * that can read everything and cost them nothing.
 *
 * Reserving is the separate first step for the same reason it is on the
 * member route: an out-of-credit caller must get a 402, and that is
 * impossible once a 200 has started.
 */
export async function POST(request: Request) {
  const auth = await requireScope(request, 'analyse');
  if (isResponse(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalid_request', 'Send a JSON body.');
  }

  const parsed = parseAnalysisInput(body);
  if (!parsed.ok) return apiError('invalid_request', parsed.error);

  // Charged at the standard member markup, not the funnel's ×2: this is the
  // customer running their own analysis through a different door, not a
  // prospect completing their funnel.
  const opts = { billedUserId: auth.userId, requireCredit: true };

  let prepared;
  try {
    prepared = await reserveAnalysis(parsed.input, opts);
  } catch (err) {
    if (err instanceof InsufficientCreditError) {
      return apiError('insufficient_credit', 'Not enough credit to run this analysis. Top up and try again.');
    }
    console.error('[api/v1/analyse] reservation failed:', err);
    return apiError('server_error', 'Could not start that analysis.');
  }

  try {
    const { result } = await runAnalysis(prepared, parsed.input, opts);
    // Saved to the member's own history, exactly as the browser analyser
    // does — an analysis run through the API is still their report, and it
    // must be findable under /reports afterwards.
    const reportId = await saveApiReport(auth.userId, parsed.input, result);
    return apiJson({ reportId, result });
  } catch (err) {
    if (err instanceof GeocodeError) {
      return apiError('invalid_request', err.message);
    }
    if (err instanceof InsufficientCreditError) {
      return apiError('insufficient_credit', 'Not enough credit to run this analysis.');
    }
    console.error('[api/v1/analyse] run failed:', err);
    return apiError('server_error', 'That analysis did not finish. Nothing has been charged for the parts that failed.');
  }
}
