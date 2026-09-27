/**
 * The short link in alert texts (myDealsLink, src/lib/sms/render.ts): My
 * deals, marked as reached from a text so the visit heartbeat counts the
 * click (src/lib/activity). Nothing is recorded here. A signed-out member is
 * sent to sign in first and keeps the marker (proxy.ts).
 */
export function GET(request: Request): Response {
  return Response.redirect(new URL('/my-deals?via=sms', request.url), 307);
}
