// TEMPORARY diagnostic — reports presence (not values) of every server-side
// API key the analyser needs, as the running function sees them. Returns
// only present/length/prefix so it is safe. DELETE once analysis works.
export const dynamic = 'force-dynamic';

function describe(v: string | undefined) {
  if (v === undefined) return { present: false };
  return { present: true, length: v.length, prefix: v.slice(0, 6) };
}

export async function GET() {
  const keys = [
    'GOOGLE_PLACES_API_KEY',
    'PROPERTYDATA_API_KEY',
    'AIRBTICS_API_KEY',
    'AIRBTICS_BASE_URL',
    'TICKETMASTER_API_KEY',
    'MONDAY_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];
  const vars: Record<string, ReturnType<typeof describe>> = {};
  for (const k of keys) vars[k] = describe(process.env[k]);
  return Response.json({ vercelEnv: process.env.VERCEL_ENV ?? null, vars });
}
