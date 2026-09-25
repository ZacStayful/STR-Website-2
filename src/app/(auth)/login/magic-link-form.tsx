'use client'

import { useActionState } from 'react'
import { requestMagicLinkAction, type FormState } from '../actions'

const initial: FormState = { error: null, success: null }

export function MagicLinkForm({ redirectTo, email }: { redirectTo: string; email: string }) {
  const [state, action, pending] = useActionState(requestMagicLinkAction, initial)

  if (state.success) {
    return <p className="text-sm text-primary">{state.success}</p>
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="redirect" value={redirectTo} />
      <div className="space-y-1.5">
        <label htmlFor="magic-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="magic-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={email}
          required
          className="w-full h-10 rounded-lg border border-border bg-input/50 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full h-10 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
      >
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  )
}
