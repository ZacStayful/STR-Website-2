import { secretsEqual } from '@/lib/crypto/secrets';
import { hasServiceRole } from '@/lib/supabase/admin';
import { TOOL_NAMES, toolSecret, type ToolName } from '@/lib/voice/config';
import { runTool, type ToolRequest } from '@/lib/voice/tools-server';

/**
 * Batch 23: the server tools Stayful Intelligence may call during a call
 * (lookup_caller, send_template_text, handoff_to_team, log_question). Every
 * request must carry the x-si-tool-token header (ELEVENLABS_TOOL_SECRET,
 * sent by ElevenLabs from a secret dynamic variable that never reaches the
 * model), compared in constant time, and must belong to a live call
 * (src/lib/voice/tools-server.ts). Logged and rate-limited per call.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tool: string }> }) {
  const secret = toolSecret();
  if (!secret) return new Response('Not configured', { status: 503 });
  if (!secretsEqual(request.headers.get('x-si-tool-token') ?? '', secret)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return new Response('Storage not configured', { status: 503 });
  const { tool } = await ctx.params;
  if (!(TOOL_NAMES as string[]).includes(tool)) return new Response('Not found', { status: 404 });
  let body: ToolRequest;
  try {
    body = (await request.json()) as ToolRequest;
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  try {
    return Response.json(await runTool(tool as ToolName, body));
  } catch (err) {
    console.error(`[voice] tool ${tool} failed:`, err);
    return Response.json({ ok: false, say: "I can't do that right now. Carry on without it." });
  }
}
