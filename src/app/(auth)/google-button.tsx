'use client'

import { useState, useSyncExternalStore } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser'
import { currentTouchValue } from '@/lib/tracking/runtime'
import { authErrorMessage } from '@/lib/auth/error-message'
import { isInAppBrowser } from '@/lib/auth/in-app-browser'

// The user agent never changes: nothing to subscribe to.
const noSubscription = () => () => {}

export function GoogleButton({ next = '' }: { next?: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Google refuses to sign anyone in from Facebook's or Instagram's in-app
  // browser (and a confirmation email opened from there lands in the real
  // browser, without this one's session). Read from the user agent once
  // hydrated (false on the server, so both render the same page); see
  // src/lib/auth/in-app-browser.ts.
  const inApp = useSyncExternalStore(noSubscription, () => isInAppBrowser(navigator.userAgent), () => false)
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  async function handleClick() {
    setLoading(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '')
    // The callback applies the landing rule; only an explicit destination is carried.
    const params = new URLSearchParams()
    if (next) params.set('next', next)
    // Batch 19: the ad or link that brought them here survives the trip to Google.
    const attr = currentTouchValue()
    if (attr) params.set('attr', attr)
    const query = params.toString()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${siteUrl}/auth/callback${query ? `?${query}` : ''}`,
      },
    })
    if (error) {
      setError(authErrorMessage(error))
      setLoading(false)
    }
  }

  if (inApp) {
    return (
      <div className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Opening from Facebook or Instagram?</span> Google sign-in doesn&apos;t work inside their browser. Tap the menu (⋯) and choose <span className="font-medium text-foreground">Open in browser</span>, or copy this page&apos;s link into Safari or Chrome. Email sign-up works here as it is.
        </p>
        <button type="button" onClick={() => void copyLink()} className="mt-2 inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted">
          {copied ? 'Link copied' : 'Copy this page’s link'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background hover:bg-muted text-foreground h-10 text-sm font-medium transition-colors disabled:opacity-50"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.4 14.4c-.2-.7-.4-1.4-.4-2.4s.1-1.7.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z"
          />
          <path
            fill="#EA4335"
            d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
          />
        </svg>
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
