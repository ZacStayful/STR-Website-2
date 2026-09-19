/**
 * The branding a customer puts on their funnel: their name, their logo, their
 * colours. Stored as jsonb on `funnels.brand`.
 *
 * Pure module (no I/O, no `server-only`, relative `.ts` imports) so it runs
 * under `node --test`. Parsing is tolerant in the same way as
 * `parseLeadRules`: a corrupted or hand-edited value falls back to Stayful's
 * own look rather than rendering a broken page for someone else's prospect.
 *
 * Logo formats. The logo has to work on two surfaces — the funnel page in a
 * browser and the generated PDF report — and only PNG and JPEG work on both.
 * `@react-pdf/renderer`'s `<Image>` takes "JPG or PNG images, as well as
 * base64 encoded image strings"; it cannot render a PDF, and an SVG needs its
 * separate `<Svg>` component rather than `<Image>`. A browser will not render
 * a PDF in an `<img>` either. So a PDF or SVG logo is rejected here rather
 * than accepted and then silently dropped from one of the two outputs.
 */

/** Colour slots a customer can set. Anything unset falls back to the app's own. */
export interface FunnelBrand {
  companyName: string | null;
  logoUrl: string | null;
  /** Buttons, links, progress — the one colour most customers will set. */
  primary: string | null;
  /** Page background behind the report. */
  background: string | null;
  /** Where a prospect's reply should go, shown on the report. */
  replyToEmail: string | null;
  /**
   * The customer's own privacy policy. Required before a funnel can go live:
   * the customer is the data controller for everyone who fills in their form
   * and Stayful is only the processor, so the consent notice has to point at
   * their policy, not ours.
   */
  privacyUrl: string | null;
}

export const EMPTY_BRAND: FunnelBrand = {
  companyName: null,
  logoUrl: null,
  primary: null,
  background: null,
  replyToEmail: null,
  privacyUrl: null,
};

/** Image types that render both in a browser and in the PDF report. */
export const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
/** Big enough for a retina logo, small enough not to slow the funnel down. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

/** A six-digit hex colour, normalised to lower case. Null for anything else. */
export function parseHexColour(v: unknown): string | null {
  const t = text(v, 7);
  return t && HEX.test(t) ? t.toLowerCase() : null;
}

/** Any https URL, for links we only ever render rather than fetch. */
export function parseHttpsUrl(v: unknown): string | null {
  const t = text(v, 2048);
  if (!t) return null;
  try {
    const url = new URL(t);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseEmail(v: unknown): string | null {
  const t = text(v, 254);
  return t && EMAIL.test(t) ? t.toLowerCase() : null;
}

/**
 * An https URL ending in a format that works on both surfaces. http is
 * refused because the funnel is served over https and a mixed-content image
 * is blocked by the browser anyway.
 */
export function parseLogoUrl(v: unknown): string | null {
  const t = text(v, 2048);
  if (!t) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const path = url.pathname.toLowerCase();
  return LOGO_EXTENSIONS.some((ext) => path.endsWith(ext)) ? url.toString() : null;
}

/** Why a logo was refused, in words a customer can act on. */
export function logoRejectionReason(v: unknown): string | null {
  const t = text(v, 2048);
  if (!t) return null;
  if (parseLogoUrl(t)) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return 'That does not look like a full web address. It should start with https://';
  }
  if (url.protocol !== 'https:') return 'The logo has to be served over https, or browsers will block it.';
  const path = url.pathname.toLowerCase();
  if (path.endsWith('.pdf')) return 'A PDF cannot be used as a logo — it will not display on the page or in the report. Please use a PNG or JPEG.';
  if (path.endsWith('.svg')) return 'SVG logos do not render in the PDF report. Please use a PNG or JPEG.';
  return 'The logo needs to be a PNG or JPEG.';
}

export function parseBrand(raw: unknown): FunnelBrand {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BRAND };
  const o = raw as Record<string, unknown>;
  return {
    companyName: text(o.companyName, 80),
    logoUrl: parseLogoUrl(o.logoUrl),
    primary: parseHexColour(o.primary),
    background: parseHexColour(o.background),
    replyToEmail: parseEmail(o.replyToEmail),
    privacyUrl: parseHttpsUrl(o.privacyUrl),
  };
}

/**
 * Whether this funnel may be switched live. A public form collecting a named
 * person's contact details and home address needs a policy to point them at,
 * and only the customer can supply it.
 */
export function activationBlockers(b: FunnelBrand): string[] {
  const missing: string[] = [];
  if (!b.privacyUrl) missing.push('a link to your privacy policy');
  if (!b.companyName) missing.push('your company name');
  return missing;
}

export function canActivate(b: FunnelBrand): boolean {
  return activationBlockers(b).length === 0;
}

/** True when nothing has been set and the funnel would look like Stayful. */
export function brandIsEmpty(b: FunnelBrand): boolean {
  return !b.companyName && !b.logoUrl && !b.primary && !b.background && !b.replyToEmail && !b.privacyUrl;
}

/**
 * The custom properties to hang on the funnel's wrapper element. `@theme
 * inline` in globals.css bridges these to every `bg-background`,
 * `text-primary` and `border-border` utility underneath, so setting them
 * re-themes the whole tree — the address autocomplete included — without
 * touching a single component.
 *
 * Only the slots a customer actually set are emitted; the rest inherit.
 * `--primary-foreground` is derived rather than asked for, because a customer
 * picking their own text-on-button colour is how you end up with unreadable
 * buttons.
 */
export function brandCssVars(b: FunnelBrand): Record<string, string> {
  const vars: Record<string, string> = {};
  if (b.primary) {
    vars['--primary'] = b.primary;
    vars['--ring'] = b.primary;
    vars['--primary-foreground'] = readableOn(b.primary);
  }
  if (b.background) vars['--background'] = b.background;
  return vars;
}

/**
 * Black or white, whichever is readable on the given colour. Uses the WCAG
 * relative-luminance formula rather than a naive average, which gets greens
 * and yellows wrong.
 */
export function readableOn(hex: string): string {
  const c = hex.replace('#', '');
  const channel = (h: string) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(c.slice(0, 2)) + 0.7152 * channel(c.slice(2, 4)) + 0.0722 * channel(c.slice(4, 6));
  // 0.179 is where contrast against black and against white are equal.
  return luminance > 0.179 ? '#111111' : '#ffffff';
}

/** What the funnel calls itself, falling back to something neutral. */
export function brandName(b: FunnelBrand): string {
  return b.companyName ?? 'Property income analysis';
}

/**
 * The consent a prospect ticks before their details are stored. Names the
 * CUSTOMER as the controller — they collected the lead, they hold it, and a
 * prospect asking "who has my data?" has to get their answer, not ours.
 */
export function consentText(b: FunnelBrand): string {
  const who = b.companyName ?? 'the company running this form';
  return `I agree that ${who} may store my details and contact me about this property.`;
}
