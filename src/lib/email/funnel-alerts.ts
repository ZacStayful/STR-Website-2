/**
 * Tells a funnel's owner that their funnel has stopped working.
 *
 * Pure: these build the message, the caller sends it. Same shape as
 * billing-emails.ts, and free of `server-only` so it runs under `node --test`.
 *
 * Every one of these walls used to be silent. A customer whose credit ran dry
 * kept collecting leads that were captured, queued and never reported on, with
 * their prospects told a report was on its way — and nothing told the customer.
 * So each email names the funnel, says plainly what stopped, and carries the
 * one link that fixes it. Nothing here is a nudge; if one of these arrives,
 * enquiries are being lost right now.
 */
import { escapeHtml as esc } from './escape.ts'
import { siteUrl } from '../url.ts'

export interface Email {
  subject: string
  html: string
  text: string
}

export type FunnelAlertKind = 'out_of_credit' | 'paused_hit' | 'daily_cap' | 'spend_cap'

function wrap(heading: string, body: string, cta: string, href: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3d2b;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 16px">${esc(heading)}</h1>
  ${body}
  <p style="margin:24px 0 0">
    <a href="${href}" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">${esc(cta)}</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#7a8274">Stayful Intelligence</p>
</div>`
}

interface AlertInput {
  kind: FunnelAlertKind
  /** The customer's own name for the funnel, so they know which one. */
  funnelName: string
  funnelId: string
}

/** What each wall means, in the customer's terms rather than ours. */
function copyFor(kind: FunnelAlertKind, name: string, settingsUrl: string): {
  subject: string
  lines: string[]
  cta: string
  href: string
} {
  switch (kind) {
    case 'out_of_credit':
      return {
        subject: `${name}: enquiries are arriving but reports are not going out`,
        lines: [
          `An enquiry came through ${name}, but there was not enough credit to run its report.`,
          'The enquiry itself is safe — the contact details and the property are saved, and the report runs by itself once you top up. Nothing has been lost.',
          'Until then, everyone filling in your form is told their report is being prepared and does not get one.',
        ],
        cta: 'Top up',
        href: siteUrl('/account/billing'),
      }
    case 'spend_cap':
      return {
        subject: `${name} has reached its daily spend limit`,
        lines: [
          `${name} has spent as much as you allowed it to today, so it has stopped running reports until midnight.`,
          'Enquiries still arrive and are still saved; their reports run once the day rolls over or you raise the limit.',
        ],
        cta: 'Review the limit',
        href: settingsUrl,
      }
    case 'daily_cap':
      return {
        subject: `${name} has reached its daily enquiry limit`,
        lines: [
          `${name} has taken as many enquiries as you allowed it to today and is now turning people away.`,
          'Anyone else filling it in is asked to try again tomorrow, so if the enquiries are worth having, the limit is worth raising.',
        ],
        cta: 'Raise the limit',
        href: settingsUrl,
      }
    case 'paused_hit':
      return {
        subject: `Somebody tried to use ${name} while it is paused`,
        lines: [
          `${name} is paused, and somebody opened its link anyway — so they saw a "not taking enquiries" page instead of your form.`,
          'If that link is on your website or in an email you are sending, those enquiries are not reaching you.',
        ],
        cta: 'Go live',
        href: settingsUrl,
      }
  }
}

export function funnelAlertEmail({ kind, funnelName, funnelId }: AlertInput): Email {
  const name = funnelName.trim() || 'Your funnel'
  const copy = copyFor(kind, name, siteUrl(`/leads/funnels/${encodeURIComponent(funnelId)}`))

  const html = copy.lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('\n  ')
  const text = [copy.subject, '', ...copy.lines, '', `${copy.cta}: ${copy.href}`].join('\n')

  return { subject: copy.subject, html: wrap(copy.subject, html, copy.cta, copy.href), text }
}
