import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSameOriginJson } from '@/lib/tracking/request';
import { prepareFull, runFull, type FullEvent } from '@/lib/chat/full-server';
import { isUuid } from '@/lib/chat/turns-server';

/**
 * Batch 26: a question in the full Stayful Intelligence view
 * (src/lib/chat/full-server.ts), streamed as server-sent events like
 * /api/deals/[id]/analysis/run. Signed-in members only; the member is always
 * the session's, never anything in the body.
 *
 * Body: { clientTurnId: uuid (the same id on a retry), question, conversationId: uuid | null }.
 * Anything decided before the model runs (switched off, a retry, too fast,
 * top up, a paused seat) comes back as plain JSON (a ChatReply). Otherwise
 * the events are start, thinking, delta, clear, replace and done. If the page
 * goes away before the answer is finished the model is stopped and nothing
 * is charged; a finished answer is charged once and a reconnect with the
 * same id gets it back.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

function sseEvent(data: FullEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in to ask Stayful Intelligence.', code: 'signed_out' }, { status: 401 });
  let body: { clientTurnId?: unknown; question?: unknown; conversationId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* handled below */
  }
  if (!isUuid(body.clientTurnId)) return Response.json({ error: 'Bad request.' }, { status: 400 });

  const prepared = await prepareFull(user, supabase, { clientTurnId: body.clientTurnId, question: body.question, conversationId: body.conversationId ?? null });
  if (prepared.kind === 'reply') return Response.json(prepared.reply);

  let gone = false;
  let abort: (() => void) | null = null;
  const live = {
    gone: () => gone,
    onGone: (fn: () => void) => {
      abort = fn;
      if (gone) fn();
    },
  };
  const leave = () => {
    if (gone) return;
    gone = true;
    try {
      abort?.();
    } catch {
      /* already stopped */
    }
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: FullEvent) => {
        if (gone) return;
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(e)));
        } catch {
          leave();
        }
      };
      after(
        (async () => {
          try {
            await runFull(prepared.job, send, live);
          } catch (err) {
            console.error('[api/chat/full] unexpected:', err);
          } finally {
            try {
              controller.close();
            } catch {
              /* the browser already went */
            }
          }
        })(),
      );
    },
    cancel() {
      leave();
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
