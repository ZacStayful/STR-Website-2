import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { claimDealAnalysisRun, runDealAnalysis } from '@/lib/analysis/deal-analysis';
import { analysisHttpStatus } from '@/lib/analysis/deal-analysis-rules';
import { recordConversion } from '@/lib/meta/conversions';
import { clientDetails } from '@/lib/tracking/request';

/**
 * Runs a started Full analysis (src/lib/analysis/deal-analysis.ts) and
 * streams its progress as server-sent events, like /api/analyse. The run is
 * handed to after() as well: once it starts it finishes, is saved and is
 * charged even if the browser goes away.
 *
 * Body: { purchaseId } from the start request. Only its buyer may run it,
 * once.
 */
export const maxDuration = 60;

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in to run a Full analysis.', code: 'signed_out' }, { status: 401 });
  let purchaseId = '';
  try {
    purchaseId = String(((await request.json()) as { purchaseId?: unknown }).purchaseId ?? '');
  } catch {
    /* handled below */
  }
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(purchaseId)) return Response.json({ error: 'Invalid request.', code: 'missing' }, { status: 400 });

  // Taken before the stream, so "already running" or "already done" is a
  // plain answer rather than a stream that errors.
  const claim = await claimDealAnalysisRun(user.id, purchaseId, id);
  if (!claim.ok) return Response.json({ error: claim.message, code: claim.code, ...(claim.reportId ? { reportId: claim.reportId } : {}) }, { status: analysisHttpStatus(claim.code) });
  const adminUser = isAdminEmail(user.email);

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
      after(
        (async () => {
          let finished = false;
          try {
            const outcome = await runDealAnalysis(claim.purchase, { adminUser, onProgress: (e) => send({ stage: e.stage, progress: e.progress, message: e.message }) });
            if (outcome.ok) {
              send({ stage: 'complete', progress: 100, message: 'Full analysis ready', reportId: outcome.reportId, reused: outcome.reused, chargedBasePence: outcome.chargedBasePence });
              finished = true;
            } else {
              send({ stage: 'error', progress: 0, message: outcome.message, code: outcome.code });
            }
          } catch (err) {
            console.error('[api/deals/analysis/run] unexpected:', err);
            send({ stage: 'error', progress: 0, message: 'Something went wrong running the Full analysis. You haven’t been charged for it; please try again.', code: 'failed' });
          } finally {
            try {
              controller.close();
            } catch {
              /* the browser already went */
            }
          }
          // Batch 19: Meta's FirstReport, once per account, only after the member
          // has their report (awaited: this already runs after the response).
          if (finished) await recordConversion({ name: 'FirstReport', userId: claim.purchase.buyer_id, details: clientDetails(request.headers) });
        })(),
      );
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
