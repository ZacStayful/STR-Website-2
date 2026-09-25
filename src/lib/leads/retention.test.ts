import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INACTIVE_DAYS, WARN_DAYS_BEFORE, ARCHIVE_GRACE_DAYS,
  archiveDueAt, purgeAfter, warnCutoff, archiveCutoff, warnedBefore, archivingSoon, retentionDate,
} from './retention.ts';

const DAY = 86_400_000;
const now = new Date('2026-09-25T02:15:00Z');

test('the shown archive date and the cron cutoff agree exactly', () => {
  // A lead whose "Archives on" date is today must be the one the cron picks
  // up today, and one due tomorrow must not be — at every day of the year.
  for (let i = 0; i < 400; i++) {
    const last = new Date(Date.UTC(2025, 0, 1) + i * DAY);
    const due = archiveDueAt(last);
    assert.ok(last.getTime() <= archiveCutoff(due).getTime(), `due day ${due.toISOString()} missed`);
    const dayBefore = new Date(due.getTime() - 1);
    assert.ok(last.getTime() > archiveCutoff(dayBefore).getTime(), `archived early for ${last.toISOString()}`);
  }
});

test('the warning is due exactly WARN_DAYS_BEFORE ahead of the archive', () => {
  const last = new Date(now.getTime() - (INACTIVE_DAYS - WARN_DAYS_BEFORE) * DAY);
  assert.ok(last.getTime() <= warnCutoff(now).getTime(), 'warning should be due');
  assert.ok(last.getTime() > archiveCutoff(now).getTime(), 'but not the archive yet');
});

test('a lead cannot be archived unless it was warned long enough ago', () => {
  const justWarned = new Date(now.getTime() - DAY);
  const warnedEarlier = new Date(now.getTime() - WARN_DAYS_BEFORE * DAY);
  assert.ok(justWarned.getTime() > warnedBefore(now).getTime());
  assert.ok(warnedEarlier.getTime() <= warnedBefore(now).getTime());
  // Two nights later, even if tonight's run starts a few seconds earlier.
  const warnedTwoNightsAgoLater = new Date(now.getTime() - WARN_DAYS_BEFORE * DAY + 30_000);
  assert.ok(warnedTwoNightsAgoLater.getTime() <= warnedBefore(now).getTime());
  // But never less than ~47 hours of notice.
  const warned46hAgo = new Date(now.getTime() - 46 * 3_600_000);
  assert.ok(warned46hAgo.getTime() > warnedBefore(now).getTime());
});

test('deletion is seven days after the customer was told', () => {
  const told = new Date('2026-03-01T02:15:00Z');
  assert.equal(purgeAfter(told).getTime() - told.getTime(), ARCHIVE_GRACE_DAYS * DAY);
});

test('archivingSoon only within the last 30 days', () => {
  assert.equal(archivingSoon(new Date(now.getTime() - 10 * DAY), now), false);
  assert.equal(archivingSoon(new Date(now.getTime() - (INACTIVE_DAYS - 20) * DAY), now), true);
  assert.equal(archivingSoon(new Date(now.getTime() - INACTIVE_DAYS * DAY), now), true);
});

test('retention dates read in UK time, with the year', () => {
  // 23:30 UTC on 31 Mar is already 1 Apr in London (BST).
  assert.equal(retentionDate('2026-03-31T23:30:00Z'), '1 Apr 2026');
  assert.equal(retentionDate('not a date'), '');
});
