import { siteUrl } from '@/lib/url';
import { AUTO_TOPUP_PAGE } from '@/lib/voice/templates';

/**
 * Batch 23: the short auto top-up link texted by Stayful Intelligence
 * (/si/topup), so the text stays one segment. It lands on the one-tap page
 * in Account → Billing (sign-in required there).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.redirect(siteUrl(`${AUTO_TOPUP_PAGE}?from=si`), 302);
}
