import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funnelPriceNoticeEmail } from './funnel-price-notice.ts';
import { DEFAULT_FUNNEL_TIERS } from '../funnels/tiers.ts';

test('the notice says when, the four tiers at both rates, and that nothing changes until then', () => {
  const e = funnelPriceNoticeEmail({ siteUrl: 'https://stayful.co.uk', firstName: 'Sam', fromDate: '2026-11-02', tiers: [...DEFAULT_FUNNEL_TIERS], enhancedExtraPence: 200, topupRate: 1.3 });
  assert.equal(e.subject, "Your lead form's prices from 2 November 2026");
  for (const s of ['Hi Sam,', 'Until then nothing changes.', 'Leads 1–20 in a month: £5.00 a lead (£6.50 from top-up credit)', 'Leads 21–60 in a month: £4.00 a lead (£5.20 from top-up credit)', 'Leads 61–150 in a month: £3.25 a lead (£4.23 from top-up credit)', 'Lead 151 and on: £2.50 a lead (£3.25 from top-up credit)', 'adds £2.00 a lead']) {
    assert.ok(e.text.includes(s), s);
  }
  assert.ok(e.html.includes('Leads 21–60'));
});

test('it is not the members’ pricing notice', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./funnel-price-notice.ts', import.meta.url), 'utf8');
  const runner = fs.readFileSync(new URL('../funnels/price-notice-run.ts', import.meta.url), 'utf8');
  // The members' stamp is never read or written here.
  assert.ok(!/pricing_notice_sent_at/.test(runner.replace(/funnel_price_notice_sent_at/g, '')));
  assert.ok(!/from '\.\/pricing-notice/.test(src));
});
