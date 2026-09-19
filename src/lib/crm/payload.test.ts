import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadPayload, leadItemName, normaliseBaseUrl, type PayloadInput } from './payload.ts';
import type { AnalysisResult } from '../types.ts';
import type { LeadVerdict } from '../leads/rules.ts';

function result(over: Record<string, unknown> = {}): AnalysisResult {
  return {
    property: { postcode: 'YO31 7NU', bedrooms: 3 },
    shortLet: {
      annualRevenue: 42_812.4,
      occupancyRate: 0.6789,
      averageDailyRate: 171.6,
      comparables: [
        { reviewCount: 40, rating: 4.8 },
        { reviewCount: 68, rating: 4.6 },
      ],
    },
    ...over,
  } as unknown as AnalysisResult;
}

function input(over: Partial<PayloadInput> = {}): PayloadInput {
  return {
    leadId: 'b3f1c2d4-1111-2222-3333-444455556666',
    createdAt: '2026-03-04T09:30:00.000Z',
    funnel: { id: 'f1', name: 'Yorkshire lettings' },
    contact: { name: ' Dana Okafor ', email: ' dana@example.com ', phone: '07700 900123', consentAt: '2026-03-04T09:29:00.000Z' },
    property: { address: ' 17 Park Crescent, York ', postcode: 'YO31 7NU', bedrooms: 3 },
    result: result(),
    reportToken: 'tok_abcdefghijklmnopqrstuvwx',
    baseUrl: 'https://stayful.co.uk',
    ...over,
  };
}

const VERDICT: LeadVerdict = {
  qualified: false,
  summary: 'Failed 1 of 3 rules.',
  unknownChecks: 1,
  checks: [
    { rule: 'bedrooms', label: 'Bedrooms', status: 'pass', actual: 3, threshold: '2–5 bedrooms', reason: '' },
    { rule: 'grossRevenue', label: 'Projected gross revenue', status: 'fail', actual: 42812, threshold: '£60,000+ gross a year', reason: 'Below the minimum.' },
  ],
};

test('a complete lead maps onto the published shape', () => {
  const p = buildLeadPayload(input());
  assert.equal(p.version, 1);
  assert.equal(p.event, 'lead.created');
  assert.equal(p.leadId, 'b3f1c2d4-1111-2222-3333-444455556666');
  assert.equal(p.contact.name, 'Dana Okafor', 'whitespace is trimmed');
  assert.equal(p.contact.email, 'dana@example.com');
  assert.equal(p.property.address, '17 Park Crescent, York');
  assert.equal(p.property.postcodeArea, 'YO');
  assert.equal(p.property.bedrooms, 3);
});

test('headline metrics are rounded to something a CRM field can show', () => {
  const m = buildLeadPayload(input()).metrics;
  assert.equal(m.annualRevenue, 42_812);
  assert.equal(m.occupancy, 0.68);
  assert.equal(m.averageNightlyRate, 172);
  assert.equal(m.averageReviewCount, 54);
  assert.equal(m.saturation, 'uncontested');
});

test('saturation bands follow the review count', () => {
  const at = (reviews: number) =>
    buildLeadPayload(input({
      result: result({ shortLet: { ...result().shortLet, comparables: [{ reviewCount: reviews, rating: 4.5 }] } }),
    })).metrics.saturation;
  assert.equal(at(30), 'uncontested');
  assert.equal(at(80), 'workable');
  assert.equal(at(140), 'competitive');
});

test('zero never stands in for unknown — a failed lookup reads as null', () => {
  // A workflow routing on `annualRevenue < 20000` must not treat a failed
  // short-let lookup as a worthless property.
  const p = buildLeadPayload(input({
    result: result({ shortLet: { annualRevenue: 0, occupancyRate: 0, averageDailyRate: 0, comparables: [] } }),
  }));
  assert.equal(p.metrics.annualRevenue, null);
  assert.equal(p.metrics.occupancy, null);
  assert.equal(p.metrics.averageNightlyRate, null);
  assert.equal(p.metrics.averageReviewCount, null);
  assert.equal(p.metrics.saturation, null);
});

test('a lead captured before its report ran carries nulls, not a false verdict', () => {
  const p = buildLeadPayload(input({ result: null, verdict: null, reportToken: null }));
  assert.equal(p.qualification.qualified, null, 'not-yet-run is not the same as failed');
  assert.equal(p.qualification.summary, '');
  assert.deepEqual(p.qualification.checks, []);
  assert.equal(p.report.url, null);
  assert.equal(p.report.pdfUrl, null);
  assert.equal(p.metrics.annualRevenue, null);
  // The contact details are still there — that is the whole point of
  // capturing the lead first.
  assert.equal(p.contact.email, 'dana@example.com');
});

test('the verdict travels in full so a CRM can show why a lead failed', () => {
  const q = buildLeadPayload(input({ verdict: VERDICT })).qualification;
  assert.equal(q.qualified, false);
  assert.equal(q.summary, 'Failed 1 of 3 rules.');
  assert.equal(q.unknownChecks, 1);
  assert.equal(q.checks.length, 2);
  assert.equal(q.checks[1].reason, 'Below the minimum.');
});

test('report links are built from the token, or omitted entirely', () => {
  const p = buildLeadPayload(input());
  assert.equal(p.report.url, 'https://stayful.co.uk/r/tok_abcdefghijklmnopqrstuvwx');
  assert.equal(p.report.pdfUrl, 'https://stayful.co.uk/r/tok_abcdefghijklmnopqrstuvwx/pdf');
  // Half a URL in a CRM field is worse than none: it looks clickable.
  assert.equal(buildLeadPayload(input({ baseUrl: null })).report.url, null);
  assert.equal(buildLeadPayload(input({ reportToken: null })).report.url, null);
});

test('a trailing slash on the base URL does not double up', () => {
  const p = buildLeadPayload(input({ baseUrl: 'https://stayful.co.uk///' }));
  assert.equal(p.report.url, 'https://stayful.co.uk/r/tok_abcdefghijklmnopqrstuvwx');
});

test('a base URL that is not a URL is refused rather than concatenated', () => {
  assert.equal(normaliseBaseUrl('stayful.co.uk'), null);
  assert.equal(normaliseBaseUrl(''), null);
  assert.equal(normaliseBaseUrl(null), null);
  assert.equal(normaliseBaseUrl('https://a.test/'), 'https://a.test');
});

test('blank contact fields come through as null, not empty strings', () => {
  const p = buildLeadPayload(input({
    contact: { name: '   ', email: '', phone: null, consentAt: null },
    property: { address: null, postcode: '  ', bedrooms: null },
  }));
  assert.equal(p.contact.name, null);
  assert.equal(p.contact.email, null);
  assert.equal(p.property.postcode, null);
  assert.equal(p.property.postcodeArea, null);
  assert.equal(p.property.bedrooms, null);
});

test('an item title always has something in it', () => {
  const full = buildLeadPayload(input());
  assert.equal(leadItemName(full), 'Dana Okafor');
  const noName = buildLeadPayload(input({ contact: { name: null, email: 'dana@example.com', phone: null, consentAt: null } }));
  assert.equal(leadItemName(noName), 'dana@example.com');
  const nothing = buildLeadPayload(input({
    contact: { name: null, email: null, phone: null, consentAt: null },
    property: { address: null, postcode: null, bedrooms: null },
  }));
  // An untitled row is a row nobody opens.
  assert.equal(leadItemName(nothing), 'Lead b3f1c2d4');
});

test('consent is carried through, because it is the lawful basis for the rest', () => {
  assert.equal(buildLeadPayload(input()).contact.consentAt, '2026-03-04T09:29:00.000Z');
});
