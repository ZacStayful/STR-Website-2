import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { payerFor } from '@/lib/team';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { insufficientCreditResponse } from '@/lib/credit/http';
import { postcodeAreaOf } from '@/lib/listing/normalise';
import { parseMarketGoals, type FinanceGoals } from '@/lib/market/goals';
import { parseAnalysisInput } from '@/lib/analysis/input';
import { reserveAnalysis, runAnalysis, enhancedEnabled, GeocodeError, type AnalysisRunOptions } from '@/lib/analysis/run';
import { reportAction } from '@/lib/credit/estimate';
import { claimReportRun, releaseReportRun } from '@/lib/analysis/report-claim';

// This route streams SSE while `runAnalysis` makes several sequential
// external API calls; the default 10s function timeout (Hobby) would cut
// the stream off mid-flight, surfacing as "Could not reach the server".
export const maxDuration = 60;

// ─── Rate Limiter (in-memory, per IP) ────────────────────────────
// 10 requests per IP per 60-second window. Protects against API credit abuse.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Clean up stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 300_000);

// ─── SSE Helper ──────────────────────────────────────────────────
function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  // Rate limiting
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';

  // Calibration bypass: dev-mode only, requires header with shared secret from .env
  const calibrationHeader = request.headers.get('x-calibration-bypass');
  const calibrationSecret = process.env.CALIBRATION_BYPASS_SECRET;
  const isCalibrationBypass =
    process.env.NODE_ENV !== 'production' &&
    calibrationSecret &&
    calibrationHeader === calibrationSecret;

  if (!isCalibrationBypass && isRateLimited(ip)) {
    return Response.json(
      { error: 'Too many requests. Please wait a minute before trying again.' },
      { status: 429 },
    );
  }

  // Auth + free-reports gate. Calibration bypass skips this (dev-only).
  let userId: string | null = null;
  let userEmail: string | null = null;
  let userName: string | null = null;
  let userMobile: string | null = null;
  // Undefined means no saved goal profile: the deal maths then borrows the
  // national mortgage average instead of a fixed default.
  let finance: FinanceGoals | undefined;
  let isAdmin = false;
  if (!isCalibrationBypass) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json(
        { error: 'You need to sign in to run an analysis.' },
        { status: 401 },
      );
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, mobile, market_goals')
      .eq('id', user.id)
      .single();
    if (!profile) {
      return Response.json({ error: 'Your account is not set up yet. Please sign in again.' }, { status: 403 });
    }
    isAdmin = isAdminEmail(user.email);
    userName = profile.full_name ?? null;
    userMobile = profile.mobile ?? null;
    userId = user.id;
    userEmail = user.email ?? null;
    finance = parseMarketGoals(profile.market_goals)?.finance;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = parseAnalysisInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const input = { ...parsed.input };

  // ─── One report at a time per listing ─────────────────────────
  // Claimed before any credit is reserved, so a double click, a second tab
  // or a refresh cannot start (and charge) a second report for the same
  // pipeline row while the first runs. See src/lib/analysis/report-claim.ts.
  let claimedRow: string | null = null;
  if (userId && input.checkedListingId) {
    const claim = await claimReportRun(userId, input.checkedListingId, { fromDeal: input.fromDeal });
    if (claim.kind === 'not_own') {
      // Never link a report to someone else's row.
      input.checkedListingId = null;
    } else if (claim.kind === 'running') {
      return Response.json({ error: 'A full report for this listing is already running. It will be saved to the deal in a minute.', code: 'report_running' }, { status: 409 });
    } else if (claim.kind === 'reported') {
      return Response.json({ error: 'This deal already has a full report.', code: 'already_reported', reportId: claim.reportId }, { status: 409 });
    } else if (claim.kind === 'claimed') {
      claimedRow = input.checkedListingId;
    }
  }
  const release = async () => {
    if (userId && claimedRow) await releaseReportRun(userId, claimedRow);
  };

  const runOpts: AnalysisRunOptions = {
    billedUserId: userId,
    admin: isAdmin || Boolean(isCalibrationBypass),
    finance,
  };

  // ─── Credit: reserve the worst-case cost before anything is spent ─────
  // Deliberately before the stream: an out-of-credit member must get a 402,
  // which is no longer possible once a 200 response body is streaming.
  let prepared;
  try {
    prepared = await reserveAnalysis(input, runOpts);
  } catch (err) {
    // The action name must match what was priced, so an enhanced report
    // reports itself as such in the out-of-credit payload.
    await release();
    if (err instanceof InsufficientCreditError) {
      return insufficientCreditResponse(err, reportAction(enhancedEnabled(input.enhancedRequested)));
    }
    throw err;
  }

  // ─── Streaming SSE Response ──────────────────────────────────
  // The run is handed to after() as well as streamed: once the credit is
  // spent, the report is finished, saved and linked to its listing even if
  // the browser goes away (a refresh, a closed tab). Sends after that point
  // are dropped instead of throwing, which used to abort the run half-charged.
  let clientGone = false;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (clientGone) return;
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(data)));
        } catch {
          clientGone = true;
        }
      };

      after((async () => {
        try {
          const { result, spend } = await runAnalysis(prepared, input, {
            ...runOpts,
            onProgress: (e) => send({ stage: e.stage, progress: e.progress, message: e.message }),
          });

          // Persist the report so it can be reopened from /reports, and link it
          // to the checked listing it came from. Done before `complete` so the
          // client receives the report id with the result.
          if (userId) {
            try {
              const supabase = await createSupabaseServerClient();
              // A team member's report is the team's: it lands in the shared
              // list under the owner who paid for it, credited to its author.
              const { payerId: ownerId } = await payerFor(userId);
              const { data: saved, error: saveError } = await supabase
                .from('saved_searches')
                .insert({
                  user_id: userId,
                  owner_id: ownerId,
                  name: result.property.address,
                  address: result.property.address,
                  postcode: result.property.postcode,
                  postcode_area: postcodeAreaOf(result.property.postcode),
                  guest_count: result.property.guests,
                  bedrooms: result.property.bedrooms,
                  kind: input.sourceListing?.kind ?? (input.rentPcm ? 'rent' : 'sale'),
                  result,
                  source_listing: input.sourceListing,
                  deal: result.deal,
                  checked_listing_id: input.checkedListingId,
                })
                .select('id')
                .single();
              if (saveError) console.error('[api/analyse] report save failed:', saveError.message);
              else if (saved?.id) {
                result.reportId = saved.id as string;
                if (input.checkedListingId) {
                  await supabase
                    .from('checked_listings')
                    .update({ analysed_report_id: saved.id, updated_at: new Date().toISOString() })
                    .eq('id', input.checkedListingId)
                    .eq('user_id', userId);
                }
                // Keep the last 200 reports per member.
                const { data: older } = await supabase.from('saved_searches').select('id').eq('user_id', userId).order('created_at', { ascending: false }).range(200, 400);
                if (older && older.length > 0) {
                  await supabase.from('saved_searches').delete().in('id', older.map((r) => r.id));
                }
              }
            } catch (err) {
              console.error('[api/analyse] report save threw:', err);
            }
          }

          send({
            stage: 'complete',
            progress: 100,
            message: 'Analysis complete',
            data: result,
            credit: { actionId: prepared.ctx.actionId, basePence: spend.basePence, chargedPence: spend.chargedPence },
          });

          // Generate the PDF report and upload it to the user's enquiry row
          // (Monday "Reports" file column), matched by email. Awaited before
          // closing the stream so Vercel doesn't kill the function mid-upload.
          const effectiveEmail = input.email ?? userEmail;
          if (effectiveEmail) {
            try {
              const { uploadPdfToMonday } = await import('@/lib/apis/monday');
              // The shared renderer, not a hand-built element: this copy and the
              // one the member downloads then cannot drift apart.
              const { renderReportPdf, reportFilename } = await import('@/lib/pdf/render');
              const buffer = await renderReportPdf(result, { preparedFor: effectiveEmail });
              await uploadPdfToMonday(
                { email: effectiveEmail, name: userName ?? undefined, mobile: userMobile ?? undefined },
                buffer,
                reportFilename(result),
              );
            } catch (err) {
              console.error('[Monday] PDF upload error:', err);
            }
          }

          // Usage is metered per provider call (credit ledger). reports_total is
          // a reporting counter only, written with the service-role client: the
          // usage counters are not grantable to `authenticated` (see the column
          // grants in supabase/schema.sql).
          if (userId) {
            try {
              const admin = createAdminClient();
              const { data: current } = await admin.from('profiles').select('reports_total').eq('id', userId).single();
              await admin
                .from('profiles')
                .update({ last_seen_at: new Date().toISOString(), reports_total: (current?.reports_total ?? 0) + 1 })
                .eq('id', userId);
            } catch (err) {
              console.error('[api/analyse] usage hook failed:', err);
            }
          }
        } catch (err) {
          if (err instanceof GeocodeError) {
            send({ stage: 'error', progress: 0, message: err.message });
          } else {
            console.error('Unexpected error in /api/analyse:', err);
            send({ stage: 'error', progress: 0, message: 'An unexpected error occurred. Please try again.' });
          }
        } finally {
          await release();
          try {
            controller.close();
          } catch {
            /* the browser already went */
          }
        }
      })());
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
