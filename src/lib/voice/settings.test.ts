import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOICE, VOICE_KEYS, parseVoice } from './settings.ts';

const from = (kv: Record<string, unknown>) => (k: string) => kv[k];

test('defaults when nothing is stored', () => {
  assert.deepEqual(parseVoice(from({})), DEFAULT_VOICE);
});

test('stored values are read; malformed ones fall back', () => {
  const s = parseVoice(from({
    [VOICE_KEYS.outboundStartHour]: '10',
    [VOICE_KEYS.outboundEndHour]: 18,
    [VOICE_KEYS.outboundWeekdays]: '[5, 1, 1, 9]',
    [VOICE_KEYS.lowCreditSpentRatio]: 0.75,
    [VOICE_KEYS.maxCallSeconds]: 'lots',
    [VOICE_KEYS.textsPerCallMax]: 5,
  }));
  assert.equal(s.outboundStartHour, 10);
  assert.equal(s.outboundEndHour, 18);
  assert.deepEqual(s.outboundWeekdays, [1, 5]);
  assert.equal(s.lowCreditSpentRatio, 0.75);
  assert.equal(s.maxCallSeconds, DEFAULT_VOICE.maxCallSeconds);
  assert.equal(s.textsPerCallMax, DEFAULT_VOICE.textsPerCallMax, 'never more than 2 texts a call');
});

test('the one-a-day limit can be 0 (calls off) or 1, never more (the database index enforces 1)', () => {
  assert.equal(parseVoice(from({ [VOICE_KEYS.maxOutboundPerUkDay]: 0 })).maxOutboundPerUkDay, 0);
  assert.equal(parseVoice(from({ [VOICE_KEYS.maxOutboundPerUkDay]: 2 })).maxOutboundPerUkDay, 1);
});

test('an end hour at or before the start is not accepted', () => {
  const s = parseVoice(from({ [VOICE_KEYS.outboundStartHour]: 12, [VOICE_KEYS.outboundEndHour]: 9 }));
  assert.ok(s.outboundEndHour > s.outboundStartHour);
});
