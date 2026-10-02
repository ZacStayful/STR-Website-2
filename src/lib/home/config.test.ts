import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIME_SAVED, TIME_SAVED_HOW, aboutFigure, aboutLabel, timeSavedMinutes } from './config.ts';

test('time saved: 30 seconds a property scanned, 30 minutes a full analysis (decided)', () => {
  assert.equal(TIME_SAVED.secondsPerPropertyScanned, 30);
  assert.equal(TIME_SAVED.minutesPerFullAnalysis, 30);
  assert.equal(timeSavedMinutes(120, 0), 60);
  assert.equal(timeSavedMinutes(0, 2), 60);
  assert.equal(timeSavedMinutes(6827, 0), 3413.5);
  assert.equal(timeSavedMinutes(6827, 3), 3413.5 + 90);
  assert.match(TIME_SAVED_HOW, /30 seconds/);
  assert.match(TIME_SAVED_HOW, /30 minutes/);
});

test('time saved: nothing, or nonsense, is 0 and never NaN', () => {
  for (const v of [0, -5, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(timeSavedMinutes(v, v), 0, String(v));
  }
  assert.equal(aboutLabel(0), null);
  assert.equal(aboutLabel(Number.NaN), null);
  assert.equal(aboutFigure(0), null);
});

test('"about X hours", and minutes under an hour', () => {
  assert.equal(aboutLabel(0.5), 'about 1 minute');
  assert.equal(aboutLabel(20), 'about 20 minutes');
  assert.equal(aboutLabel(59.4), 'about 59 minutes');
  assert.equal(aboutLabel(59.6), 'about 1 hour');
  assert.equal(aboutLabel(90), 'about 2 hours');
  assert.equal(aboutLabel(timeSavedMinutes(6827, 0)), 'about 57 hours');
  assert.equal(aboutLabel(timeSavedMinutes(8302, 0)), 'about 69 hours');
  assert.deepEqual(aboutFigure(3413.5), { value: 57, unit: 'hours' });
  assert.deepEqual(aboutFigure(20), { value: 20, unit: 'minutes' });
});
