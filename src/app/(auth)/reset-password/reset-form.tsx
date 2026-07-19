'use client'

import { useActionState } from 'react'
import { updatePasswordAction, type AuthState } from '../actions'
import { PasswordField } from '../PasswordField'

const initial: AuthState = { error: null }

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initial)

  return (
    <form action={action} className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          New password
        </label>
        <PasswordField id="password" name="password" autoComplete="new-password" minLength={8} />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">
          Confirm new password
        </label>
        <PasswordField id="confirm" name="confirm" autoComplete="new-password" minLength={8} />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {pending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  )
}
