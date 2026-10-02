/**
 * Batch 22f: the three ways a management company puts its lead form on its
 * own site — the link, a button in its colour, and an embed — as the text
 * they copy. Pure, so the escaping is tested: these are pasted into someone
 * else's website, and a company name with a quote in it must not break it.
 */
import { readableOn } from './brand.ts';

function attr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function text(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_COLOUR = '#2E3D2B';

export const BUTTON_LABEL = 'What could your property earn?';

/** A plain <a>, styled inline in their colour, opening the form in a new tab. */
export function buttonSnippet(url: string, colour: string | null | undefined, label: string = BUTTON_LABEL): string {
  const bg = colour && HEX.test(colour) ? colour : DEFAULT_COLOUR;
  const fg = readableOn(bg);
  return `<a href="${attr(url)}" target="_blank" rel="noopener" style="display:inline-block;background:${bg};color:${fg};padding:12px 20px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;text-decoration:none">${text(label)}</a>`;
}

/** The form inside their page. Tall enough for the form; the report scrolls inside it. */
export function embedSnippet(url: string, companyName: string | null | undefined): string {
  const title = `${companyName?.trim() || 'Property'} income report`;
  return `<iframe src="${attr(url)}" title="${attr(title)}" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`;
}

export type SnippetKind = 'link' | 'button' | 'embed';

export function isSnippetKind(v: unknown): v is SnippetKind {
  return v === 'link' || v === 'button' || v === 'embed';
}
