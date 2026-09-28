import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auctionCash, auctionMethod, auctionPrice, buyersPremium, DEFAULT_AUCTION_TERMS, isAuctionLot, parseAuctionTerms } from './auction.ts';
import { auctionDeal, purchaseDeal } from '../listing/deal.ts';
import { stampDutyLocal } from '../listing/stamp-duty.ts';

// The live "Guide price" sale deals on 28 Sep 2026, streets and postcodes left out.
const GUIDE_PRICE_SALES = [
  { title: '5 bed detached house for sale - £950,000', features: 'Tenure: Freehold | Study | 2,700 sq ft floor area' },
  { title: '5 bed semi-detached house for sale - £695,000', features: 'Tenure: Freehold | Study | 2,199 sq ft floor area' },
  { title: '5 bed end of terrace house for sale - £750,000', features: 'Tenure: Freehold | Study | 2,331 sq ft floor area' },
  { title: '3 bed semi-detached house for sale - £550,000', features: 'Chain free | Three Bedrooms | Modern Kitchen & Bathroom | Driveway & Parking | Large Garden | Convenient for Station and Town Centre | Potential to Extend STPP' },
  { title: '4 bed detached house for sale - £2,250,000', features: 'Elegant mid-century, detached family home | Approximately 2,429 sq ft (226 SQM) | Beautiful, generous south-westerly garden | Four bedrooms & three generous reception rooms | Double garage and driveway parking' },
  { title: '3 bed semi-detached house for sale - £485,000', features: 'Tenure: Freehold | 1,689 sq ft floor area' },
  { title: '3 bed terraced house for sale - £440,000', features: 'Chain free | Victorian period freehold terrace home | Moments from popular Central Park | Three double bedrooms | Two receptions | EPC - C' },
  { title: '3 bed terraced house for sale - £425,000', features: 'Single Bayed Mid Terraced House | Poets Estate Location | 3 Bedrooms | First Floor Bathroom/WC | 2 Reception Rooms | Large Rear Garden' },
  { title: '3 bed terraced house for sale - £500,000', features: 'Chain free | Beautifully presented Victorian terrace home | Three spacious double bedrooms | Large through lounge | Extended modern kitchen diner' },
  { title: '4 bed detached house for sale - £895,000', features: 'Four Bedroom | Two Bathrooms | Beautifully-presented | Detached Family Home | Ample Easy Parking | Open-Plan Living' },
  { title: '4 bed terraced house for sale - £749,950', features: 'Four Bedrooms, Two Bathrooms | Village Location | Garden Room/Office | Open-plan Living | Guest Cloakroom | Driveway Parking' },
  { title: '2 bed terraced house for sale - £300,000', features: 'Beautifully renovated two-bedroom terraced house | Modern fitted kitchen | Spacious lounge/dining room | Double doors leading to the rear garden' },
];
const MOSSFORD = {
  title: '4 bed semi-detached house for sale - £130,000',
  features: 'Vacant property | Private Driveway Parking | Private Garden (front and back) | Likely to attract enquiries from Serious Investors & Developers | Property Scheduled for Online Auction',
};
const text = (l: { title: string; features: string }) => `${l.title} | Guide price | ${l.features}`;

test('"Guide price" alone is not an auction: none of the twelve live guide-price sales is one', () => {
  for (const l of GUIDE_PRICE_SALES) assert.equal(isAuctionLot({ text: text(l) }), false, l.title);
});

test('the one scheduled for online auction is, and it runs on the modern method', () => {
  assert.equal(isAuctionLot({ text: text(MOSSFORD) }), true);
  assert.equal(auctionMethod(text(MOSSFORD)), 'modern');
});

test('auction wording needs context: an address with Auction in it is not a lot', () => {
  assert.equal(isAuctionLot({ text: '2 bed flat for sale, Auction Close, Bristol' }), false);
  assert.equal(isAuctionLot({ text: 'Apartment in The Old Auction House' }), false);
  assert.equal(isAuctionLot({ text: 'For sale by auction | Legal pack available' }), true);
  assert.equal(isAuctionLot({ text: 'Auction date 14 October' }), true);
  assert.equal(isAuctionLot({ text: 'Offered via the Modern Method of Auction' }), true);
  assert.equal(auctionMethod('For sale by auction'), 'traditional');
});

test('a portal flag or the auction cohort is enough on its own', () => {
  assert.equal(isAuctionLot({ flag: true, text: '3 bed house' }), true);
  assert.equal(isAuctionLot({ inCohort: true }), true);
  assert.equal(isAuctionLot({ flag: false, text: '3 bed house', inCohort: false }), false);
});

test('the premium: £1,500 in a traditional room, 4.5% + VAT with a £6,000 floor on the modern method', () => {
  assert.equal(buyersPremium(149_500, 'traditional'), 1_500);
  assert.equal(buyersPremium(149_500, 'modern'), 8_073);
  assert.equal(buyersPremium(80_000, 'modern'), 6_000, '4.5% + VAT of £80k is £4,320: the floor applies');
});

test('Mossford: guide £130k bought at ≈£149.5k needs ≈£85k in on auction terms, not £59k', () => {
  const standard = purchaseDeal(130_000, { grossRevenue: 30_000, adr: 120, bedrooms: 4 });
  assert.equal(standard.cashRequired, 59_100, "25% deposit £32,500 + stamp duty £6,600 + setup £20,000");
  assert.equal(auctionPrice(130_000), 149_500);
  const sdlt = stampDutyLocal(149_500, 'england').amount;
  assert.equal(sdlt, 7_965);
  const cash = auctionCash(149_500, sdlt, 20_000, 'modern');
  assert.equal(cash.deposit, 44_850);
  assert.equal(cash.loan, 104_650);
  assert.equal(cash.premium, 8_073);
  assert.equal(cash.fees, 4_093);
  assert.equal(cash.interest, 10_674);
  assert.equal(cash.cashRequired, 84_981);
  const deal = auctionDeal(130_000, 'modern', { grossRevenue: 30_000, adr: 120, bedrooms: 4 });
  assert.equal(deal.askingPrice, 149_500);
  assert.equal(deal.cashRequired, 84_981);
  assert.equal(deal.auction?.guide, 130_000);
  // The cash flow is the member's mortgage on the adjusted price, after the refinance.
  assert.equal(deal.cashflowMonthly, purchaseDeal(149_500, { grossRevenue: 30_000, adr: 120, bedrooms: 4 }).cashflowMonthly);
  assert.ok(deal.cashRequired > 50_000, 'not a low-entry deal');
});

test('stored auction terms are read field by field; junk keeps the default', () => {
  assert.deepEqual(parseAuctionTerms(undefined), DEFAULT_AUCTION_TERMS);
  const t = parseAuctionTerms({ upliftPct: 10, bridgingLtvPct: '75', termMonths: 0, vatPct: 'lots' });
  assert.equal(t.upliftPct, 10);
  assert.equal(t.bridgingLtvPct, 75);
  assert.equal(t.termMonths, DEFAULT_AUCTION_TERMS.termMonths);
  assert.equal(t.vatPct, DEFAULT_AUCTION_TERMS.vatPct);
  assert.equal(parseAuctionTerms(JSON.stringify({ upliftPct: 20 })).upliftPct, 20);
});
