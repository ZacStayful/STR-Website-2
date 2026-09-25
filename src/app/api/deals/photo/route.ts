import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { verifyExpiringFromEnv, signingConfigured } from "@/lib/crypto/sign";

// ─── Deal photo ────────────────────────────────────────────────────────
// Serves a marketplace deal's main photo without exposing the portal's own
// image URL (Rightmove's media paths carry the property id, which is what a
// member pays to see). The URL is signed and expiring (see photoUrlFor), so
// the route needs no session and the CDN may cache it. Upstream headers are
// dropped and redirects are not followed, so nothing about the source leaks.

export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES = 4 * 1024 * 1024;
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e8ebe3"/><path d="M120 200l50-60 40 45 30-35 40 50z" fill="#c3d1ab"/><circle cx="270" cy="105" r="18" fill="#c3d1ab"/></svg>`;

function placeholder(status = 200): Response {
  return new Response(PLACEHOLDER, { status, headers: { "content-type": "image/svg+xml", "cache-control": "public, s-maxage=3600, max-age=600" } });
}

export async function GET(request: Request) {
  if (!signingConfigured() || !hasServiceRole()) return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyExpiringFromEnv(id, params.get("exp"), params.get("sig"))) {
    return new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const { data } = await createAdminClient().from("marketplace_deals").select("photo").eq("id", id).maybeSingle();
  const photo = typeof data?.photo === "string" && /^https?:\/\//.test(data.photo) ? data.photo : null;
  if (!photo) return placeholder();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(photo, { headers: { "user-agent": UA, accept: "image/avif,image/webp,image/*,*/*;q=0.8" }, redirect: "manual", cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    const type = res.headers.get("content-type") ?? "";
    const length = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || !type.startsWith("image/") || length > MAX_BYTES) return placeholder();
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return placeholder();
    return new Response(body, { status: 200, headers: { "content-type": type, "cache-control": "public, s-maxage=86400, stale-while-revalidate=86400, max-age=3600" } });
  } catch {
    return placeholder();
  }
}
