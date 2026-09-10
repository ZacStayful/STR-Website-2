/**
 * CORS for /api/ext/*. The extension's service worker calls with host
 * permissions and needs no CORS, but content-script or popup fetches carry
 * a chrome-extension:// origin, so those ids are allowed explicitly.
 * Origins are configured with EXTENSION_IDS (comma-separated), defaulting
 * to NEXT_PUBLIC_EXTENSION_ID.
 */

export function allowedExtensionOrigins(): Set<string> {
  const raw = process.env.EXTENSION_IDS || process.env.NEXT_PUBLIC_EXTENSION_ID || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[a-p]{32}$/.test(s))
      .map((id) => `chrome-extension://${id}`),
  );
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !allowedExtensionOrigins().has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(request: Request, body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: { ...corsHeaders(request), ...(init.headers ?? {}) } });
}
