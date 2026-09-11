/**
 * Confirmation emails for the self-serve pause and cancel flows.
 *
 * Pure: these build the message, the caller sends it. That keeps them
 * unit-testable and free of `server-only`, matching digestEmail in
 * src/lib/market/alerts.ts.
 *
 * Both carry a link straight back to /account, because the most valuable thing
 * a member can do after either email is change their mind.
 */
import { escapeHtml as esc } from './escape.ts'
import { siteUrl } from '../url.ts'

export interface Email {
  subject: string
  html: string
  text: string
}

const ACCOUNT_URL = () => siteUrl('/account')

function wrap(heading: string, body: string, cta: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3d2b;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 16px">${esc(heading)}</h1>
  ${body}
  <p style="margin:24px 0 0">
    <a href="${ACCOUNT_URL()}" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">${esc(cta)}</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#7a8274">Stayful Intelligence</p>
</div>`
}

export function pauseBookedEmail({
  from,
  until,
}: {
  from: string | null
  until: string | null
}): Email {
  const subject = until ? `Your Stayful plan pauses until ${until}` : 'Your Stayful plan is paused'

  const when =
    from && until
      ? `Your plan carries on as normal until <strong>${esc(from)}</strong>. From then you won't be charged, and your account is on hold until <strong>${esc(until)}</strong>, when it starts again by itself.`
      : "Your plan is on hold. You won't be charged while it's paused, and it starts again by itself."

  const body = `<p style="margin:0 0 12px">${when}</p>
  <p style="margin:0 0 12px">Your saved reports, watchlist and deal pipeline all stay exactly as they are — nothing is deleted while you're paused.</p>
  <p style="margin:0">Changed your mind? You can restart any time.</p>`

  const text = [
    subject,
    '',
    from && until
      ? `Your plan carries on as normal until ${from}. From then you won't be charged, and your account is on hold until ${until}, when it starts again by itself.`
      : "Your plan is on hold. You won't be charged while it's paused.",
    '',
    'Your saved reports, watchlist and deal pipeline all stay exactly as they are.',
    '',
    `Restart any time: ${ACCOUNT_URL()}`,
  ].join('\n')

  return { subject, html: wrap(subject, body, 'Restart my plan'), text }
}

export function cancelScheduledEmail({ endsOn }: { endsOn: string | null }): Email {
  const subject = endsOn
    ? `Your Stayful plan ends on ${endsOn}`
    : 'Your Stayful plan has been cancelled'

  const when = endsOn
    ? `You keep full access until <strong>${esc(endsOn)}</strong>. Nothing further will be charged.`
    : 'You keep full access until the end of the period you have already paid for. Nothing further will be charged.'

  const body = `<p style="margin:0 0 12px">${when}</p>
  <p style="margin:0 0 12px">If you'd rather take a break than leave, you can pause for one, two or three months instead and pick up where you left off.</p>
  <p style="margin:0">Changed your mind? You can undo this any time before it takes effect.</p>`

  const text = [
    subject,
    '',
    endsOn
      ? `You keep full access until ${endsOn}. Nothing further will be charged.`
      : 'You keep full access until the end of the period you have already paid for.',
    '',
    'If you would rather take a break than leave, you can pause for one, two or three months instead.',
    '',
    `Undo this any time before it takes effect: ${ACCOUNT_URL()}`,
  ].join('\n')

  return { subject, html: wrap(subject, body, 'Keep my plan'), text }
}
