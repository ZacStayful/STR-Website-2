/**
 * Batch 23: Stayful Intelligence's contact card (vCard 3.0), served at
 * /si/card and linked from the intro text — UK texts can't carry
 * attachments. Pure.
 */
import { PERSONA_NAME } from '../persona/stayful-intelligence.ts';

/** vCard text escaping (RFC 2426 §4). */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/** Fold lines longer than 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) out.push(` ${line.slice(i, i + 74)}`);
  return out.join('\r\n');
}

export function buildVCard(o: { tel: string; url: string; photoPngBase64?: string | null }): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(PERSONA_NAME)}`,
    `N:${esc('Intelligence')};${esc('Stayful')};;;`,
    `ORG:${esc('Stayful')}`,
    `TITLE:${esc('AI property assistant')}`,
    `TEL;TYPE=CELL,VOICE:${o.tel.replace(/[^+\d]/g, '')}`,
    `URL:${o.url}`,
    `NOTE:${esc(`I'm ${PERSONA_NAME}, your AI property assistant from Stayful. I'll call when there's something worth your time.`)}`,
    ...(o.photoPngBase64 ? [`PHOTO;ENCODING=b;TYPE=PNG:${o.photoPngBase64}`] : []),
    'END:VCARD',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
