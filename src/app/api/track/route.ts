/**
 * The analyser's session beacon (src/lib/tracker.ts) posts here on page
 * unload. Batch 21 (C22): nothing is stored or logged any more. The in-memory
 * list it fed was never read, and the Monday push behind it has been a no-op
 * since the enquiries board lost its time-on-site column. The route stays so
 * the beacon never 404s; branch 21g retires the tracker with it.
 */
export async function POST() {
  return new Response(null, { status: 204 });
}
