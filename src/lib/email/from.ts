/**
 * Who a white-label email appears to come from.
 *
 * A funnel's report email is sent from OUR verified Resend domain, because
 * sending from the customer's own domain needs per-customer DNS verification
 * that does not exist yet. But it must not arrive saying "Stayful": the
 * prospect filled in a form branded as the customer's, and an email from a
 * company they have never heard of, about a report they asked someone else
 * for, reads as spam.
 *
 * So the DISPLAY NAME becomes the customer's and the address stays ours,
 * with reply-to pointed at the customer. That is what every white-label
 * platform does, and the limitation is worth being honest about: the address
 * still says our domain until per-domain verification is built.
 *
 * The display name is the dangerous part. It comes from a customer-supplied
 * company name and ends up inside an email header, so a newline in it would
 * let the rest of the header be rewritten — a recipient, a different
 * reply-to, anything. Pure and tested for exactly that reason.
 */

export interface EmailIdentity {
  name: string | null;
  address: string;
}

/** Parses `Name <addr@host>` or a bare `addr@host`. */
export function parseEmailFrom(raw: string | undefined | null): EmailIdentity | null {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (t.length === 0) return null;

  const angled = t.match(/^(.*)<([^<>]+)>\s*$/);
  if (angled) {
    const name = angled[1].trim().replace(/^"(.*)"$/, '$1').trim();
    const address = angled[2].trim();
    return address.includes('@') ? { name: name.length > 0 ? name : null, address } : null;
  }
  return t.includes('@') && !/\s/.test(t) ? { name: null, address: t } : null;
}

/**
 * Strips everything that could break out of a display name.
 *
 * CR and LF first — those are the header-injection characters. Then the
 * quoting and angle brackets that would otherwise confuse where the name
 * ends and the address begins, and any other control character.
 */
export function safeDisplayName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')
    .replace(/["<>;,\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The `from` header for a funnel email: the customer's name, our address.
 *
 * Falls back to whatever `EMAIL_FROM` already says when there is no usable
 * name — an email from us is better than an email from nobody.
 */
export function brandedFrom(envFrom: string | undefined | null, displayName: string | null | undefined): string | null {
  const identity = parseEmailFrom(envFrom);
  if (!identity) return null;

  const name = safeDisplayName(displayName);
  if (!name) return envFrom ? String(envFrom).trim() : null;

  // Always quoted. A name containing a dot or a comma is otherwise a
  // different header to a strict parser.
  return `"${name}" <${identity.address}>`;
}

/** A reply-to only when it is a plausible single address; never a header. */
export function safeReplyTo(raw: string | null | undefined): string | null {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (t.length === 0 || t.length > 254) return null;
  if (/[\r\n\s<>,;]/.test(t)) return null;
  return /^[^@]+@[^@.]+\.[^@]+$/.test(t) ? t : null;
}
