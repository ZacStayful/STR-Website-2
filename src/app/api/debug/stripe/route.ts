// TEMPORARY diagnostic — confirms the Stripe + Supabase-admin env vars are
// reaching the runtime. Reports only presence/length/prefix, never the full
// secret. DELETE once payments are confirmed working.
export const dynamic = "force-dynamic";

function describe(name: string) {
  const v = process.env[name];
  if (v === undefined) return { present: false };
  return { present: true, length: v.length, prefix: v.slice(0, 8) };
}

export async function GET() {
  return Response.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vars: {
      STRIPE_SECRET_KEY: describe("STRIPE_SECRET_KEY"),
      STRIPE_WEBHOOK_SECRET: describe("STRIPE_WEBHOOK_SECRET"),
      SUPABASE_SERVICE_ROLE_KEY: describe("SUPABASE_SERVICE_ROLE_KEY"),
    },
  });
}
