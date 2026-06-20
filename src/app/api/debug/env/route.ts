// TEMPORARY diagnostic — reports presence (not full values) of the auth
// env vars, BOTH as the running function sees them at runtime AND as they
// were inlined at build time (which is what the real app code uses).
// Returns only presence/length/first-few-chars so it is safe to hit.
// DELETE once the signup env-var issue is resolved.
export const dynamic = 'force-dynamic';

function describe(v: string | undefined) {
  if (v === undefined) return { present: false, value: null };
  return { present: true, length: v.length, prefix: v.slice(0, 12) };
}

export async function GET() {
  return Response.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    // Dynamic key access — NOT inlined, reads the live lambda environment.
    runtime: {
      NEXT_PUBLIC_SUPABASE_URL: describe(process.env['NEXT_PUBLIC_SUPABASE_URL']),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: describe(process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']),
      NEXT_PUBLIC_SITE_URL: describe(process.env['NEXT_PUBLIC_SITE_URL']),
    },
    // Static references — inlined at build time, exactly what the app's
    // createSupabaseServerClient() actually receives.
    buildTime: {
      NEXT_PUBLIC_SUPABASE_URL: describe(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: describe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      NEXT_PUBLIC_SITE_URL: describe(process.env.NEXT_PUBLIC_SITE_URL),
    },
  });
}
