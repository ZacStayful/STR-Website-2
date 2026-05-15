// Diagnostic endpoint for confirming which env vars reach the function
// runtime on Vercel. Returns presence + length + first-15-char prefix —
// never the full value. Safe-to-public because NEXT_PUBLIC_* vars are
// already shipped to the browser, and the rest are masked.
//
// Usage:
//   curl https://<deployment>.vercel.app/api/debug/env
//
// Remove this route once the signup bug is resolved.

const VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MONDAY_API_KEY',
  'MONDAY_TRIAL_BOARD_ID',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PAYMENT_LINK_URL',
] as const

type VarStatus =
  | { status: 'UNDEFINED' }
  | { status: 'EMPTY_STRING' }
  | { status: 'PRESENT'; length: number; prefix: string }

function describe(name: string): VarStatus {
  const v = process.env[name]
  if (v === undefined) return { status: 'UNDEFINED' }
  if (v === '') return { status: 'EMPTY_STRING' }
  return {
    status: 'PRESENT',
    length: v.length,
    prefix: v.slice(0, 15),
  }
}

export async function GET() {
  const out: Record<string, VarStatus> = {}
  for (const name of VARS) {
    out[name] = describe(name)
  }
  return Response.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelUrl: process.env.VERCEL_URL ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    vars: out,
  })
}
