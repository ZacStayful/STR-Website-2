import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

function describeEnv(name: string): string {
  const v = process.env[name]
  if (v === undefined) return `${name}=UNDEFINED`
  if (v === '') return `${name}=EMPTY_STRING`
  return `${name}=[len=${v.length}, prefix="${v.slice(0, 15)}"]`
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  console.log(
    '[supabase-server] env check:',
    describeEnv('NEXT_PUBLIC_SUPABASE_URL'),
    '|',
    describeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  )

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component — Supabase will refresh
            // sessions via the proxy instead.
          }
        },
      },
    }
  )
}
