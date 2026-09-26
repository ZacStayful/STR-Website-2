/**
 * The one-off notice that daily picks now go to every plan, with the way to
 * switch them off. Sent once per member from the admin picks page, never on
 * deploy. Pure: the runner sends it.
 */
import { escapeHtml as esc } from './escape.ts'
import { manageNotificationsUrl } from '../url.ts'

export interface Email {
  subject: string
  html: string
  text: string
}

export function dailyNoticeEmail({ siteUrl, firstName }: { siteUrl: string; firstName?: string | null }): Email {
  const base = siteUrl.replace(/\/$/, '')
  const manage = manageNotificationsUrl(base)
  const picks = `${base}/picks`
  const subject = 'Your Stayful picks are now daily'
  const hi = firstName ? `Hi ${firstName},` : 'Hi,'
  const paragraphs = [
    'A quick note: Stayful Intelligence now sends every member one property pick a day, whatever plan you are on. Each morning we look for the listing that best fits your filter — or a house pick from our best-scoring areas if you have not set one — check its page, and email it to you with the figures.',
    'Each pick uses a few pence of your credit, and only goes out when there is something new worth sending.',
    'If a pick a day is more than you want, you can switch them off in one click from your new Notifications page, where every email we send is listed with its own switch.',
  ]
  const text = [
    hi,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    `Manage notifications: ${manage}`,
    `See every pick we have sent you: ${picks}`,
    '',
    'Stayful Intelligence',
  ].join('\n')
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3d2b;max-width:520px;margin:0 auto;padding:24px">
  <p style="margin:0 0 14px">${esc(hi)}</p>
  ${paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('\n  ')}
  <p style="margin:24px 0 0">
    <a href="${esc(manage)}" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">Manage notifications</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#7a8274">Stayful Intelligence · <a href="${esc(picks)}" style="color:#7a8274">Every pick we have sent you</a></p>
</div>`
  return { subject, html, text }
}
