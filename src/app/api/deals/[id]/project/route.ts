import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasServiceRole } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { payerFor } from "@/lib/team";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { dealSheet } from "@/lib/marketplace/open";
import { logActivity } from "@/lib/activity/log";
import { ukDay } from "@/lib/activity/week";
import { isLineKey } from "@/lib/project/costing";

/**
 * What a member did on a Project deal's sheet (Batch 17, Part H), sent from
 * the browser once it has really happened (so a prefetch never counts):
 *
 *   view        the Project section was on screen (project_view)
 *   working     they opened the working to change it (project_working)
 *   line_edit   they changed a line (project_line_edit), `line` its key
 *   line_add    they added a line of their own (project_line_add), `line` its key
 *
 * Each once a member, deal (and line) and UK day. Deal ids and line keys
 * only, never a figure. The working ones only for a member whose account has
 * opened the deal (the working is only shown then).
 *
 * Body: { event, line? }.
 */
const EVENTS = { view: "project_view", working: "project_working", line_edit: "project_line_edit", line_add: "project_line_add" } as const;
const UUID = /^[0-9a-f-]{36}$/i;
const OWN_KEY = /^own-\d{1,3}$/;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  let body: { event?: unknown; line?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* refused below */
  }
  const event = typeof body.event === "string" && body.event in EVENTS ? (body.event as keyof typeof EVENTS) : null;
  if (!event) return new Response(null, { status: 400 });
  const line = typeof body.line === "string" && (isLineKey(body.line) || OWN_KEY.test(body.line)) ? body.line : null;
  if ((event === "line_edit" || event === "line_add") && !line) return new Response(null, { status: 400 });
  if (event !== "view") {
    if (!hasServiceRole()) return new Response(null, { status: 503 });
    const adminUser = isAdminEmail(user.email);
    const { payerId } = await payerFor(user.id);
    const sheet = await dealSheet(id, payerId, adminUser, await dealVisibilityFor(user.id, adminUser));
    if (!sheet?.priv) return new Response(null, { status: 403 });
  }
  const day = ukDay(new Date());
  const dedupeKey = line ? `${EVENTS[event]}:${id}:${line}:${day}` : `${EVENTS[event]}:${id}:${day}`;
  logActivity(user.id, EVENTS[event], { dealId: id, dedupeKey, extras: line ? { line } : undefined });
  return new Response(null, { status: 204 });
}
