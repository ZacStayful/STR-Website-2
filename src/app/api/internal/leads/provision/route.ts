import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";
import { ensureWelcomeGrant } from "@/lib/credit/welcome";
import { parseLeadGoals } from "@/lib/market/lead-goals";
import { normaliseMobile } from "@/lib/credit/abuse";
import { sendEmail } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/escape";
import { siteUrl } from "@/lib/url";
import { confirmLink } from "@/lib/auth/magic-link";

// ─── Lead-form provisioning ───────────────────────────────────────────
// Turns a Meta lead-form submission (relayed by n8n) into a member: the
// account is created, the form's answers become their Market Explorer goals
// and a saved area, the welcome credit is granted, and a magic link is
// emailed. Tomorrow's daily pick then reaches them whether or not they ever
// clicked the form's redirect — the product arrives by email before the
// redirect matters. Idempotent on email: a second post for the same address
// returns the existing member and grants nothing twice.
//
//   POST { email, phone?, name?, area?, postcode?, budget?, bedrooms?, kind?, maxRentPcm?, source?, leadId? }
//   → { userId, created, welcomeGranted, magicLinkSent, magicLink, areaCode, goals }
//
// `magicLink` is the same single-use sign-in link the email carries, returned
// so n8n can put it in the WhatsApp welcome too. It is a token-hash link to
// /auth/confirm (built from generateLink's hashed_token), so it works on any
// device and needs no PKCE cookie. A second click after the first has signed
// the member in still lands them in the app. It expires after the Supabase
// project's email OTP expiry; the sign-in page offers a fresh one.
//
//   curl -X POST -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" \
//     -d '{"email":"lead@example.com","area":"York","budget":"250000","bedrooms":3,"kind":"buy","source":"meta_lead_form","leadId":"123"}' \
//     https://<host>/api/internal/leads/provision
//
// The n8n side (Meta Lead Ads trigger → this route → Meta Conversions API
// "Lead" event → WhatsApp welcome) is built separately; the activation event
// ("CompleteRegistration") fires from /auth/callback the first time the
// member signs in (LEAD_ACTIVATION_WEBHOOK_URL).

export const runtime = "nodejs";
export const maxDuration = 30;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function welcomeEmail(input: { name: string | null; link: string; areaName: string | null }): { subject: string; html: string; text: string } {
  const hi = input.name ? `Hi ${input.name.split(" ")[0]},` : "Hi,";
  const where = input.areaName ? ` in ${input.areaName}` : "";
  const text = [
    hi,
    "",
    `Your Stayful Intelligence account is ready, with £20 of credit on it. Every morning we'll email you one property${where} that earns clearly more as a short let than a long let, and you can browse every deal on the market in our top areas at ${siteUrl("/deals")}.`,
    "",
    `Sign in with this link (no password needed): ${input.link}`,
    "",
    "The Stayful team",
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#2e3d2b;max-width:560px">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">Stayful Intelligence</p>
      <p>${escapeHtml(hi)}</p>
      <p>Your account is ready, with <strong>£20 of credit</strong> on it. Every morning we’ll email you one property${escapeHtml(where)} that earns clearly more as a short let than a long let, and you can browse every deal on the market in our top areas.</p>
      <p><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#2e3d2b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Sign in and see today’s deals</a></p>
      <p style="color:#7a8274;font-size:13px">No password needed; the link signs you in. If you didn’t ask for this, ignore it and nothing happens.</p>
    </div>`.trim();
  return { subject: "Your Stayful account is ready: £20 of credit and today’s deals", html, text };
}

export async function POST(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: "Storage not configured" }, { status: 503 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return Response.json({ error: "A valid email is required" }, { status: 400 });
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;
  const mobile = normaliseMobile(typeof body.phone === "string" ? body.phone : null);
  const { goals, areaCode } = parseLeadGoals(body);
  const source = typeof body.source === "string" ? body.source.slice(0, 60) : "lead_form";
  const leadId = typeof body.leadId === "string" || typeof body.leadId === "number" ? String(body.leadId).slice(0, 80) : null;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // ── The member: existing by email, else created ──
  let userId: string | null = null;
  let created = false;
  const { data: existing } = await admin.from("profiles").select("id, market_goals, mobile, lead_source, sourcing_opted_out_at").ilike("email", email).limit(1);
  const existingRow = (existing ?? [])[0] as { id: string; market_goals: unknown; mobile: string | null; lead_source: unknown; sourcing_opted_out_at: string | null } | undefined;
  if (existingRow) {
    userId = existingRow.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name ?? undefined, mobile: mobile ?? undefined, lead_source: source } });
    if (error || !data.user) {
      // A race, or an auth user without a profile row: look once more before giving up.
      const { data: again } = await admin.from("profiles").select("id").ilike("email", email).limit(1);
      const id = (again ?? [])[0]?.id as string | undefined;
      if (!id) return Response.json({ error: `Could not create the member: ${error?.message ?? "unknown"}` }, { status: 500 });
      userId = id;
    } else {
      userId = data.user.id;
      created = true;
    }
  }

  // ── Goals, area, provenance. Never overwrite goals a member set themselves. ──
  const update: Record<string, unknown> = { lead_source: { source, leadId, provisionedAt: nowIso, ...(existingRow?.lead_source && typeof existingRow.lead_source === "object" ? { first: existingRow.lead_source } : {}) } };
  if (!existingRow?.market_goals) Object.assign(update, { market_goals: goals, market_goals_updated_at: nowIso });
  // A member who turned picks off in Notifications stays off: only an account
  // that never made that choice is enrolled here.
  if (!existingRow?.market_goals && !existingRow?.sourcing_opted_out_at) Object.assign(update, { sourcing_alerts: true, sourcing_opted_out_at: null });
  if (mobile && !existingRow?.mobile) update.mobile = mobile;
  if (name && created) update.full_name = name;
  // The trigger creates the profile on auth.users insert; it may lag a fresh createUser by a moment.
  let profileOk = false;
  for (let attempt = 0; attempt < 3 && !profileOk; attempt += 1) {
    const { data: prof } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (prof) profileOk = true;
    else await new Promise((r) => setTimeout(r, 400));
  }
  if (!profileOk) {
    const { error } = await admin.from("profiles").insert({ id: userId, email, full_name: name, mobile });
    if (error && error.code !== "23505") console.error("[leads] profile insert failed:", error.message);
  }
  const { error: upErr } = await admin.from("profiles").update(update).eq("id", userId);
  if (upErr) console.error("[leads] profile update failed:", upErr.message);
  if (areaCode) {
    const { error: areaErr } = await admin.from("saved_areas").upsert({ user_id: userId, postcode_area: areaCode }, { onConflict: "user_id,postcode_area", ignoreDuplicates: true });
    if (areaErr) console.error("[leads] saved area failed:", areaErr.message);
  }

  // ── Welcome credit (idempotent) ──
  let welcomeGranted = false;
  try {
    welcomeGranted = (await ensureWelcomeGrant(userId, email)).granted;
  } catch (err) {
    console.error("[leads] welcome grant failed:", (err as Error)?.message ?? err);
  }

  // ── The magic link ──
  // generateLink's action_link is Supabase's own verify URL, which finishes with
  // the session in the URL fragment (no `code`), so /auth/callback cannot
  // complete it. Build a token-hash link to /auth/confirm instead, which
  // verifies the hash server-side.
  let magicLinkSent = false;
  let magicLink: string | null = null;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error("[leads] magic link failed:", linkErr?.message);
  } else {
    magicLink = confirmLink(link.properties.hashed_token, "/deals");
    let areaName: string | null = null;
    if (areaCode) {
      const { areaMetaForCode } = await import("@/lib/market/areas");
      areaName = areaMetaForCode(areaCode).name;
    }
    const mail = welcomeEmail({ name, link: magicLink, areaName });
    const res = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
    magicLinkSent = res.sent;
  }

  return Response.json({ userId, created, welcomeGranted, magicLinkSent, magicLink, areaCode, goals: { kind: goals.sourcingKind, budget: goals.budget, bedrooms: goals.bedrooms } });
}
