// TEMPORARY diagnostic — reports presence (not full values) of the env
// vars the auth flow needs, as seen by the running serverless function.
// Returns only presence/length/first-few-chars so it is safe to hit.
// DELETE once the signup env-var issue is resolved.
export const dynamic = 'force-dynamic';

function describe(name: string) {
  const v = process.env[name];
  if (v === undefined) return { present: false, value: null };
  return {
    present: true,
    length: v.length,
    prefix: v.slice(0, 12),
  };
}

export async function GET() {
  return Response.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    vars: {
      NEXT_PUBLIC_SUPABASE_URL: describe('NEXT_PUBLIC_SUPABASE_URL'),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: describe('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      NEXT_PUBLIC_SITE_URL: describe('NEXT_PUBLIC_SITE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: describe('SUPABASE_SERVICE_ROLE_KEY'),
    },
  });
}
