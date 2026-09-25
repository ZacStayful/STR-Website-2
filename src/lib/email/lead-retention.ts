/**
 * The two emails behind lead retention (src/lib/leads/retention.ts): "these
 * leads will be archived in 2 days" and "these leads were archived and will
 * be deleted on …".
 *
 * Pure: these build the message, the cron sends it. Same shape as
 * funnel-alerts.ts, and free of `server-only` so it runs under `node --test`.
 *
 * Both exist so that nothing a customer holds is ever removed without them
 * hearing about it first. Every name and address in them came from a
 * stranger typing into a public form, so every one is escaped.
 */
import { escapeHtml as esc } from './escape.ts'
import { siteUrl } from '../url.ts'
import { retentionDate } from '../leads/retention.ts'

export interface Email {
  subject: string
  html: string
  text: string
}

export interface RetentionLead {
  name: string | null
  email: string | null
  address: string | null
  createdAt: string
}

/** Enough to recognise the batch; the rest is a click away. */
const LISTED = 10

const LINK_NOTE =
  'Report links you have already sent on — to your CRM, or the homeowner’s own copy — stop working once a lead is deleted. ' +
  'Download the PDF first if you need to keep one.'

function who(l: RetentionLead): string {
  return l.name?.trim() || l.email?.trim() || 'Unnamed enquiry'
}

function line(l: RetentionLead): string {
  const parts = [who(l), l.address?.trim() || null, `enquired ${retentionDate(l.createdAt)}`].filter(Boolean)
  return parts.join(' · ')
}

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

function listHtml(leads: RetentionLead[]): string {
  const shown = leads.slice(0, LISTED)
  const more = leads.length - shown.length
  return `<ul style="margin:0 0 16px;padding-left:20px">${shown.map((l) => `<li>${esc(line(l))}</li>`).join('')}</ul>${
    more > 0 ? `<p style="margin:0 0 16px">…and ${more} more.</p>` : ''
  }`
}

function listText(leads: RetentionLead[]): string {
  const shown = leads.slice(0, LISTED)
  const more = leads.length - shown.length
  return `${shown.map((l) => `- ${line(l)}`).join('\n')}${more > 0 ? `\n…and ${more} more.` : ''}`
}

function plural(n: number): string {
  return n === 1 ? '1 lead' : `${n} leads`
}

/** Sent 2 days before unused leads are archived. */
export function archiveWarningEmail(input: { leads: RetentionLead[]; archiveOn: string | Date }): Email {
  const n = input.leads.length
  const when = retentionDate(input.archiveOn)
  const href = `${siteUrl()}/leads`
  const subject = `${plural(n)} will be archived on ${when}`
  const intro = `${n === 1 ? 'This lead hasn’t' : 'These leads haven’t'} been opened, sent to your CRM or revisited by the homeowner for 6 months, so ${n === 1 ? 'it' : 'they'} will be archived on ${when}.`
  const keep = 'To keep one, just open it in Leads — that resets its clock. Anything archived can still be restored for 7 days before it is deleted.'

  return {
    subject,
    html: wrap(
      subject,
      `<p style="margin:0 0 16px">${esc(intro)}</p>${listHtml(input.leads)}<p style="margin:0 0 16px">${esc(keep)}</p><p style="margin:0;font-size:13px;color:#7a8274">${esc(LINK_NOTE)}</p>`,
      'Open Leads',
      href,
    ),
    text: `${intro}\n\n${listText(input.leads)}\n\n${keep}\n\n${LINK_NOTE}\n\nOpen Leads: ${href}\n`,
  }
}

/** Sent when unused leads have been archived; they are deleted on `deleteOn`. */
export function archivedEmail(input: { leads: RetentionLead[]; deleteOn: string | Date }): Email {
  const n = input.leads.length
  const when = retentionDate(input.deleteOn)
  const href = `${siteUrl()}/leads?tab=archived`
  const subject = `${plural(n)} archived — deleted on ${when} unless restored`
  const intro = `${n === 1 ? 'This lead was' : 'These leads were'} archived after 6 months without being used, and will be deleted permanently on ${when}.`
  const keep = 'If you still need one, restore it from the Archived tab before then.'

  return {
    subject,
    html: wrap(
      subject,
      `<p style="margin:0 0 16px">${esc(intro)}</p>${listHtml(input.leads)}<p style="margin:0 0 16px">${esc(keep)}</p><p style="margin:0;font-size:13px;color:#7a8274">${esc(LINK_NOTE)}</p>`,
      'Review archived leads',
      href,
    ),
    text: `${intro}\n\n${listText(input.leads)}\n\n${keep}\n\n${LINK_NOTE}\n\nReview archived leads: ${href}\n`,
  }
}
