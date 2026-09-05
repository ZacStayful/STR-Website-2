import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestChanges, digestEmail } from './alerts.ts';
import type { AreaCardData } from './explorer.ts';
import type { AreaTrend } from './trend.ts';

const card = (code: string, tier: string) => ({ code, name: code, confidence: { tier } }) as unknown as AreaCardData;
const trend = (direction: AreaTrend['enquiries']['direction'], deltaPct: number | null = 0.2) =>
  ({ enquiries: { direction, deltaPct }, since: '2026-03' }) as unknown as AreaTrend;

test('first digest after saving records state without alerting (no previous direction)', () => {
  const changes = digestChanges([{ postcode_area: 'M', last_alerted_direction: null, last_alerted_tier: null }], new Map([['M', card('M', 'building')]]), new Map([['M', trend('up')]]));
  assert.equal(changes.length, 0);
});

test('a flipped trend or a new Confirmed tier is reported once', () => {
  const saved = [
    { postcode_area: 'M', last_alerted_direction: 'flat', last_alerted_tier: 'building' },
    { postcode_area: 'NG', last_alerted_direction: 'up', last_alerted_tier: 'building' },
    { postcode_area: 'YO', last_alerted_direction: 'up', last_alerted_tier: 'confirmed' },
  ];
  const cards = new Map([['M', card('M', 'building')], ['NG', card('NG', 'confirmed')], ['YO', card('YO', 'confirmed')]]);
  const trends = new Map([['M', trend('up')], ['NG', trend('up')], ['YO', trend('up')]]);
  const changes = digestChanges(saved, cards, trends);
  assert.deepEqual(changes.map((c) => [c.code, c.trendChanged, c.becameConfirmed]), [['M', true, false], ['NG', false, true]]);
});

test('insufficient never counts as a flip', () => {
  const changes = digestChanges([{ postcode_area: 'M', last_alerted_direction: 'up', last_alerted_tier: 'confirmed' }], new Map([['M', card('M', 'confirmed')]]), new Map([['M', trend('insufficient', null)]]));
  assert.equal(changes.length, 0);
});

test('digest email lists every change and links the explorer', () => {
  const changes = digestChanges([{ postcode_area: 'M', last_alerted_direction: 'flat', last_alerted_tier: 'building' }], new Map([['M', card('M', 'building')]]), new Map([['M', trend('down', -0.25)]]));
  const e = digestEmail(changes, 'https://intelligence.stayful.co.uk');
  assert.match(e.subject, /M has changed/);
  assert.match(e.text, /falling \(-25%\)/);
  assert.match(e.html, /href="https:\/\/intelligence.stayful.co.uk\/markets\/m"/);
});
