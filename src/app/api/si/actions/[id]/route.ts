import { createSupabaseServerClient } from '@/lib/supabase/server';
import { hasServiceRole } from '@/lib/supabase/admin';
import { isSameOriginJson } from '@/lib/tracking/request';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPipelineStatus } from '@/lib/listing/pipeline';
import { actingMemberFor } from '@/lib/si-actions/member-server';
import { confirmWithCredit, instructionView, keepLink, nextStep, stopInstruction, applyUseThisStep } from '@/lib/si-actions/run-server';
import { undoInstruction } from '@/lib/si-actions/undo-server';
import { moveAfterDraft } from '@/lib/si-actions/draft-server';
import { isUuid } from '@/lib/si-actions/store-server';

/**
 * Batch 27: one instruction Stayful Intelligence is carrying out for the
 * member (src/lib/si-actions). The id is the question's own id; it is only
 * ever looked up with the session's member, so nobody can reach another
 * member's instruction.
 *
 *   GET                       the card as it stands (steps whose long part ran through
 *                             their button's own route are settled first)
 *   POST { op: 'next' }       after the Stop countdown: start the next charged step
 *                             (refused before the countdown ends); returns what the page
 *                             runs through the button's own route, if anything
 *   POST { op: 'stop' }       Stop (before anything charged: nothing charged runs; after:
 *                             what hasn't started doesn't)
 *   POST { op: 'confirm', yes }   the confirm card's answer
 *   POST { op: 'undo' }       Undo (24 hours; charges are never undone)
 *   POST { op: 'keep', stepId }   Keep a checked listing (into My deals as Kept)
 *   POST { op: 'move', dealId, stage }   a draft's "Move to …", on the member's tap
 *   POST { op: 'use_this', key }    the answer's "Use this" (Batch 22's what-if), with Undo
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

async function who() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { member, seatPaused } = await actingMemberFor(user);
  return { supabase, member, seatPaused };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const w = await who();
  if (!w) return Response.json({ error: 'Sign in.' }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'Not available just now.' }, { status: 503 });
  const card = await instructionView(w.member, id);
  return card ? Response.json({ card }) : Response.json({ error: 'Not found.' }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const w = await who();
  if (!w) return Response.json({ error: 'Sign in.' }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'Not available just now.' }, { status: 503 });
  let body: { op?: unknown; yes?: unknown; stepId?: unknown; dealId?: unknown; stage?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* handled below */
  }
  try {
    switch (body.op) {
      case 'next': {
        // A paused seat may not spend the team's credit: nothing charged starts.
        if (w.seatPaused) return Response.json({ error: 'Your seat is paused, so I can’t spend the team’s credit.', code: 'seat_paused' }, { status: 403 });
        const r = await nextStep(w.member, w.supabase, id);
        if (!r) return Response.json({ error: 'Not found.' }, { status: 404 });
        if (r.kind === 'out_of_credit') return Response.json({ card: r.card, code: 'insufficient_credit', requiredPence: r.credit.requiredPence, availablePence: r.credit.availablePence });
        return Response.json({ card: r.card, ...(r.kind === 'wait' ? { waitMs: r.waitMs } : {}), ...(r.kind === 'started' ? { handOut: r.handOut } : {}) });
      }
      case 'stop': {
        const card = await stopInstruction(w.member, id);
        return card ? Response.json({ card }) : Response.json({ error: 'Not found.' }, { status: 404 });
      }
      case 'confirm': {
        if (body.yes === true && w.seatPaused) return Response.json({ error: 'Your seat is paused, so I can’t spend the team’s credit.', code: 'seat_paused' }, { status: 403 });
        const r = await confirmWithCredit(w.member, id, body.yes === true);
        if (!r) return Response.json({ error: 'Not found.' }, { status: 404 });
        return Response.json({ card: r.card, ...(r.credit ? { code: 'insufficient_credit', requiredPence: r.credit.requiredPence, availablePence: r.credit.availablePence } : {}) });
      }
      case 'undo': {
        const card = await undoInstruction(w.member, w.supabase, id);
        return card ? Response.json({ card }) : Response.json({ error: 'Not found.' }, { status: 404 });
      }
      case 'keep': {
        const card = await keepLink(w.member, id, body.stepId);
        return card ? Response.json({ card }) : Response.json({ error: 'Not found.' }, { status: 404 });
      }
      case 'move': {
        if (!isUuid(body.dealId) || !isPipelineStatus(body.stage)) return Response.json({ error: 'Bad request.' }, { status: 400 });
        const r = await moveAfterDraft(createAdminClient(), w.member, id, body.dealId, body.stage);
        return Response.json(r, { status: r.ok ? 200 : 409 });
      }
      case 'use_this': {
        const r = await applyUseThisStep(w.member, w.supabase, id, (body as { key?: unknown }).key);
        return Response.json(r.card ? { card: r.card } : { error: r.error }, { status: r.card ? 200 : 409 });
      }
      default:
        return Response.json({ error: 'Bad request.' }, { status: 400 });
    }
  } catch (err) {
    console.error('[si-actions] route failed:', (err as Error)?.message ?? err);
    return Response.json({ error: 'Something went wrong, so nothing more was done. Please try again.' }, { status: 500 });
  }
}
