import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { markEmailVerified } from '@/lib/monday/enquiries'

// Handles both OAuth (Google) callback and email-confirmation links.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/estimate'
  const error = searchParams.get('error_description') || searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createSupabaseServerClient()
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
    )
  }

  // After a successful email-confirmation exchange, flip the Monday
  // "Email Verified" checkbox for this user's enquiry item. Best-effort.
  const userId = data.user?.id
  if (userId) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('monday_item_id')
        .eq('id', userId)
        .single()
      if (profile?.monday_item_id) {
        await markEmailVerified(profile.monday_item_id)
      }
    } catch (err) {
      console.error('[auth/callback] markEmailVerified failed:', err)
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
