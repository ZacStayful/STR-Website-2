import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaTag, BUILDING_HISTORY } from './delta.ts';
import type { TrendResult } from './trend.ts';

const t = (direction: TrendResult['direction'], deltaPct: number | null, priorMonths = 3): TrendResult => ({
  direction, deltaPct, recent: null, prior: null, monthsUsed: 6, recentMonths: 3, priorMonths,
});

test('insufficient or missing trend reads as building history', () => {
  assert.deepEqual(deltaTag(null), { text: BUILDING_HISTORY, tone: 'neutral' });
  assert.deepEqual(deltaTag(undefined), { text: BUILDING_HISTORY, tone: 'neutral' });
  assert.deepEqual(deltaTag(t('insufficient', null)), { text: BUILDING_HISTORY, tone: 'neutral' });
  assert.deepEqual(deltaTag(t('up', null)), { text: BUILDING_HISTORY, tone: 'neutral' });
});

test('flat is steady, up/down carry a signed percentage and the window', () => {
  assert.deepEqual(deltaTag(t('flat', 0.01)), { text: 'Steady vs prior 3 mo', tone: 'neutral' });
  assert.deepEqual(deltaTag(t('up', 0.083)), { text: '+8% vs prior 3 mo', tone: 'up' });
  assert.deepEqual(deltaTag(t('down', -0.125, 2)), { text: '−13% vs prior 2 mo', tone: 'down' });
});

test('never mentions a year', () => {
  for (const d of [t('up', 0.5), t('down', -0.2), t('flat', 0), t('insufficient', null)]) assert.doesNotMatch(deltaTag(d).text, /year/i);
});
