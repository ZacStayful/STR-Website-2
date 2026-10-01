import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { siteUrl } from '@/lib/url';
import { buildVCard } from '@/lib/voice/vcard';

/**
 * Batch 23: Stayful Intelligence's contact card (/si/card), linked from the
 * intro text and the missed-intro text and email — UK texts can't carry
 * attachments. Public: it holds only SI's name, the number (TWILIO_FROM_NUMBER,
 * the one number for calls and texts) and the logo. Never anything about a
 * member.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const tel = (process.env.TWILIO_FROM_NUMBER ?? '').trim();
  if (!tel) return new Response('Not configured', { status: 503 });
  const photo = await readFile(path.join(process.cwd(), 'public', 'images', 'si-contact.png'))
    .then((b) => b.toString('base64'))
    .catch(() => null);
  const body = buildVCard({ tel, url: siteUrl(), photoPngBase64: photo });
  return new Response(body, {
    headers: {
      'content-type': 'text/vcard; charset=utf-8',
      'content-disposition': 'attachment; filename="Stayful-Intelligence.vcf"',
      'cache-control': 'public, max-age=3600',
    },
  });
}
