/**
 * A Message (./message.ts) as an email: subject, plain text, HTML and the
 * List-Unsubscribe headers. The only place member-email markup is written;
 * every string that goes into HTML is escaped here.
 *
 * Every email carries the "Manage notifications" link, and one-click
 * unsubscribe (RFC 8058) when the message names one.
 *
 * Pure: no network, no database, no server-only.
 */
import { escapeHtml as esc } from '../email/escape.ts';
import type { Block, Item, Link, Message, Section, Tone } from './message.ts';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** RFC 8058 one-click headers: the POST target first, then the page. */
export function listUnsubscribeHeaders(u: { url: string; oneClickUrl: string }): Record<string, string> {
  return { 'List-Unsubscribe': `<${u.oneClickUrl}>, <${u.url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

// ── Text ──

function textOfItem(i: Item): string[] {
  return [`• ${i.title}`, ...i.lines.map((l) => `  ${l}`), ...(i.link ? [`  ${i.link.label}: ${i.link.url}`] : [])];
}

function textOfBlock(b: Block): string[] {
  switch (b.type) {
    case 'heading':
      return [b.text];
    case 'text':
      return [b.text];
    case 'image':
      return [];
    case 'facts':
      return b.rows.map((r) => `  ${r.label}: ${r.value}`);
    case 'buttons':
      return b.links.map((l) => `${l.label}: ${l.url}`);
    case 'items':
      return b.items.flatMap((i, n) => (n === 0 ? textOfItem(i) : ['', ...textOfItem(i)]));
  }
}

function textOfSection(s: Section): string[] {
  const lines: string[] = [];
  if (s.title) lines.push(s.title.toUpperCase(), '');
  s.blocks.forEach((b, n) => {
    const out = textOfBlock(b);
    if (out.length === 0) return;
    // Items and buttons read better with a gap before them; lines of prose run on.
    if (n > 0 && (b.type === 'items' || b.type === 'buttons' || s.blocks[n - 1].type === 'items')) lines.push('');
    lines.push(...out);
  });
  return lines;
}

// ── HTML ──

const TONE_STYLE: Record<Tone, string> = {
  normal: 'margin:0 0 6px',
  muted: 'margin:0 0 6px;color:#7a8274;font-size:13px',
  strong: 'margin:0 0 6px;font-weight:600;color:#2e3d2b',
  accent: 'margin:0 0 6px;color:#5d8156',
  callout: 'margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#f5f2e8;color:#2e3d2b;font-size:14px',
  small: 'margin:0 0 6px;color:#5b6657;font-size:14px;border-left:3px solid #5d8156;padding-left:10px',
};

function button(l: Link): string {
  return `<a href="${esc(l.url)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px;${l.primary ? 'background:#5d8156;color:#fff' : 'background:#eef2ea;color:#2e3d2b'}">${esc(l.label)}</a>`;
}

function htmlOfItem(i: Item): string {
  const lines = i.lines.map((l) => `<br><span style="color:#5b6657;font-size:14px">${esc(l)}</span>`).join('');
  const link = i.link ? `<br><a href="${esc(i.link.url)}" style="color:#5d8156;font-size:14px;font-weight:600">${esc(i.link.label)}</a>` : '';
  return `<li style="margin:0 0 14px"><strong>${esc(i.title)}</strong>${lines}${link}</li>`;
}

function htmlOfBlock(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `<h1 style="font-size:22px;margin:0 0 6px">${esc(b.text)}</h1>`;
    case 'text':
      return `<p style="${TONE_STYLE[b.tone ?? 'normal']}">${esc(b.text)}</p>`;
    case 'image':
      return `<img src="${esc(b.url)}" alt="" width="560" style="display:block;width:100%;max-width:560px;border-radius:12px;margin:0 0 14px">`;
    case 'facts':
      return `<table role="presentation" style="margin:0 0 12px;border-collapse:collapse;font-size:13px;color:#5b6657">${b.rows.map((r) => `<tr><td style="padding:1px 12px 1px 0">${esc(r.label)}</td><td style="padding:1px 0;font-weight:600;color:#2e3d2b">${esc(r.value)}</td></tr>`).join('')}</table>`;
    case 'buttons':
      return `<p style="margin:0 0 14px">${b.links.map(button).join('')}</p>`;
    case 'items':
      return `<ul style="padding-left:18px;margin:0 0 10px">${b.items.map(htmlOfItem).join('')}</ul>`;
  }
}

function htmlOfSection(s: Section, first: boolean): string {
  const title = s.title ? `<h2 style="font-size:16px;margin:${first ? '0' : '26px'} 0 10px;color:#2e3d2b">${esc(s.title)}</h2>` : first ? '' : '<div style="height:18px"></div>';
  return `${title}${s.blocks.map(htmlOfBlock).join('')}`;
}

/**
 * Sections as a fragment to place inside another email (the picks-paused
 * letter carries the changes this way, keeping its own plain layout).
 */
export function renderSections(sections: readonly Section[]): { text: string; html: string } {
  return {
    text: sections.flatMap((s, n) => (n === 0 ? textOfSection(s) : ['', ...textOfSection(s)])).join('\n'),
    html: sections.map((s, n) => htmlOfSection(s, n === 0)).join(''),
  };
}

// ── The email ──

export function renderEmail(m: Message): RenderedEmail {
  const footerText = [
    m.reason,
    ...(m.unsubscribe ? [`${m.unsubscribe.label}: ${m.unsubscribe.url}`] : []),
    `Manage notifications: ${m.manageUrl}`,
  ];
  const text = [...m.sections.flatMap((s, n) => (n === 0 ? textOfSection(s) : ['', '', ...textOfSection(s)])), '', ...footerText].join('\n');
  const footerHtml = `<p style="color:#7a8274;font-size:12px;margin:26px 0 0">${esc(m.reason)}${m.unsubscribe ? ` <a href="${esc(m.unsubscribe.url)}" style="color:#7a8274">${esc(m.unsubscribe.label)}</a> ·` : ''} <a href="${esc(m.manageUrl)}" style="color:#7a8274">Manage notifications</a>.</p>`;
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#2e3d2b;max-width:560px">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">${esc(m.eyebrow)}</p>
      ${m.sections.map((s, n) => htmlOfSection(s, n === 0)).join('\n      ')}
      ${footerHtml}
    </div>`.trim();
  return { subject: m.subject, text, html, headers: m.unsubscribe ? listUnsubscribeHeaders(m.unsubscribe) : {} };
}
