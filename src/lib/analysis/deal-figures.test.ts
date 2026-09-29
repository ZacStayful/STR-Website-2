import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atCurrentMortgageResult, dealFigures } from './deal-figures.ts';
import { monthlyCashflow, monthlyMortgage, rentToRentDeal, type PurchaseDeal } from '../listing/deal.ts';
import type { AnalysisResult } from '../types.ts';

const monthlyRevenue: AnalysisResult['shortLet']['monthlyRevenue'] = [1800, 1900, 2200, 2600, 2900, 3300, 3600, 3700, 2900, 2400, 1900, 1800];
const shortLet = { annualRevenue: monthlyRevenue.reduce((a, b) => a + b, 0), averageDailyRate: 140, monthlyRevenue };
const input = { shortLet, bedrooms: 2, taxCountry: 'england' as const, askingPrice: 220_000, rentPcm: null, estimatedValue: null, councilTax: null, growth: null, liveRate: null };

type Slice = Pick<AnalysisResult, 'deal' | 'cashflow' | 'shortLet'>;

test('a full analysis is worked on the interest-only mortgage', () => {
  const f = dealFigures(input);
  assert.equal(f.deal?.kind, 'purchase');
  if (f.deal?.kind !== 'purchase') return;
  assert.equal(f.deal.mortgageType, 'interest_only');
  assert.equal(f.deal.mortgageMonthly, 756);
  assert.equal(f.cashflow?.length, 12);
  assert.equal(f.cashflow?.[0].fixed, 756);
});

test('a report saved on the repayment formula reads at the current mortgage, months rebuilt; a current one is the same object', () => {
  const fresh = dealFigures(input);
  const now = fresh.deal as PurchaseDeal;
  // The same report as it was saved before the type existed.
  const loan = now.askingPrice * (1 - now.depositPct / 100);
  const oldMortgage = Math.round(monthlyMortgage(loan, now.mortgageRatePct, now.termYears));
  const old: PurchaseDeal & { basis: 'asking-price'; minProfitPcm: number } = { ...now, basis: 'asking-price', minProfitPcm: 500, mortgageMonthly: oldMortgage, cashflowMonthly: Math.round(now.netOperating / 12 - oldMortgage) };
  delete old.mortgageType;
  const saved: Slice = { shortLet: shortLet as AnalysisResult['shortLet'], deal: old, cashflow: monthlyCashflow(monthlyRevenue, oldMortgage, { billsPcm: now.billsPcm }) };
  assert.ok(saved.cashflow![0].fixed > 1000, 'saved with the repayment payment');

  const refreshed = atCurrentMortgageResult(saved);
  assert.notEqual(refreshed, saved);
  assert.equal(refreshed.deal?.kind, 'purchase');
  if (refreshed.deal?.kind !== 'purchase') return;
  assert.equal(refreshed.deal.mortgageType, 'interest_only');
  assert.equal(refreshed.deal.mortgageMonthly, now.mortgageMonthly);
  assert.equal(refreshed.deal.cashflowMonthly, now.cashflowMonthly);
  assert.equal(refreshed.deal.minProfitPcm, 500, 'the report extras ride through');
  assert.equal(refreshed.deal.basis, 'asking-price');
  assert.deepEqual(refreshed.cashflow, fresh.cashflow, 'the twelve months are exactly what a fresh report writes');
  // Already current: the same object back.
  const current: Slice = { shortLet: shortLet as AnalysisResult['shortLet'], deal: fresh.deal, cashflow: fresh.cashflow };
  assert.equal(atCurrentMortgageResult(current), current);
  // No deal, or a rent-to-rent one: untouched.
  const none: Slice = { shortLet: shortLet as AnalysisResult['shortLet'], deal: null, cashflow: null };
  assert.equal(atCurrentMortgageResult(none), none);
  const r2r: Slice = { shortLet: shortLet as AnalysisResult['shortLet'], deal: { ...rentToRentDeal(1_100, { grossRevenue: shortLet.annualRevenue, adr: 140, bedrooms: 2 }), basis: 'advertised-rent', minProfitPcm: 500 }, cashflow: monthlyCashflow(monthlyRevenue, 1_100) };
  assert.equal(atCurrentMortgageResult(r2r), r2r);
});

test('a saved cash flow with no monthly series is refreshed row by row', () => {
  const fresh = dealFigures(input);
  const now = fresh.deal as PurchaseDeal;
  const old: PurchaseDeal = { ...now, mortgageMonthly: 1013, cashflowMonthly: Math.round(now.netOperating / 12 - 1013) };
  delete old.mortgageType;
  const rows = monthlyCashflow(monthlyRevenue, 1013, { billsPcm: now.billsPcm });
  const saved = { shortLet: { ...shortLet, monthlyRevenue: [] as unknown as AnalysisResult['shortLet']['monthlyRevenue'] } as AnalysisResult['shortLet'], deal: { ...old, basis: 'asking-price' as const, minProfitPcm: 500 }, cashflow: rows };
  const refreshed = atCurrentMortgageResult(saved);
  assert.equal(refreshed.cashflow?.length, 12);
  for (let i = 0; i < 12; i += 1) {
    assert.equal(refreshed.cashflow![i].fixed, now.mortgageMonthly);
    assert.equal(refreshed.cashflow![i].revenue, rows[i].revenue);
    assert.ok(Math.abs(refreshed.cashflow![i].net - fresh.cashflow![i].net) <= 1, `month ${i + 1}: ${refreshed.cashflow![i].net} vs ${fresh.cashflow![i].net}`);
  }
});
