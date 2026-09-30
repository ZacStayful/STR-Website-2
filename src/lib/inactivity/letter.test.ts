import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awayLetter } from './letter.ts';

test('the away letter: why, how to restart, one button to Today, the manage link', () => {
  const m = awayLetter({ siteUrl: 'https://intelligence.stayful.co.uk/', firstName: 'Sam' });
  assert.equal(m.subject, 'We’ve paused your daily deals while you’re away');
  assert.ok(m.text.startsWith('Hi Sam,'));
  assert.ok(m.text.includes('We’ve paused your daily deals while you’re away, so nothing more comes out of your credit. Sign in to start them again: they restart with the next morning’s run.'));
  assert.ok(m.text.includes('Start my daily deals: https://intelligence.stayful.co.uk/today'));
  assert.equal((m.html.match(/<a /g) ?? []).length, 2, 'one button and the footer link');
  assert.ok(m.html.includes('>Start my daily deals</a>'));
  assert.ok(m.text.includes('Manage notifications: https://intelligence.stayful.co.uk/account/notifications'));
});

test('a team member hears it is the team’s credit; the day’s changes ride along and name themselves in the subject', () => {
  const team = awayLetter({ siteUrl: 'https://x.test', team: true });
  assert.ok(team.text.includes('comes out of your team’s credit'));
  assert.ok(team.text.startsWith('Hi,'));
  const extra = { text: 'CHANGES ON YOUR DEALS\n\n• Price drop', html: '<h2>Changes on your deals</h2>', subjectSuffix: '1 price drop on a deal you kept' };
  const withChanges = awayLetter({ siteUrl: 'https://x.test', extra });
  assert.equal(withChanges.subject, 'We’ve paused your daily deals while you’re away · 1 price drop on a deal you kept');
  assert.ok(withChanges.text.indexOf('Price drop') < withChanges.text.indexOf('Manage notifications'));
  assert.ok(withChanges.html.includes('<h2>Changes on your deals</h2>'));
});
