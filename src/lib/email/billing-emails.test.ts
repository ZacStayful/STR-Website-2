import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelScheduledEmail, pauseBookedEmail } from './billing-emails.ts';

test('the pause email names both ends of the window', () => {
  const e = pauseBookedEmail({ from: '14 July 2026', until: '14 September 2026' });
  assert.match(e.subject, /14 September 2026/);
  assert.match(e.html, /14 July 2026/);
  assert.match(e.html, /14 September 2026/);
  assert.match(e.text, /14 July 2026/);
  // The most useful thing after this email is changing your mind.
  assert.match(e.html, /\/account/);
  assert.match(e.text, /\/account/);
});

test('the pause email still reads sensibly with no dates', () => {
  const e = pauseBookedEmail({ from: null, until: null });
  assert.ok(e.subject.length > 0);
  assert.doesNotMatch(e.html, /null|undefined/);
  assert.doesNotMatch(e.text, /null|undefined/);
});

test('the cancellation email leads with the end date and offers a pause', () => {
  const e = cancelScheduledEmail({ endsOn: '14 October 2026' });
  assert.match(e.subject, /14 October 2026/);
  assert.match(e.html, /14 October 2026/);
  // The retention pitch belongs here too, not only in the dialog.
  assert.match(e.html, /pause/i);
  assert.match(e.html, /\/account/);
});

test('the cancellation email still reads sensibly with no end date', () => {
  const e = cancelScheduledEmail({ endsOn: null });
  assert.ok(e.subject.length > 0);
  assert.doesNotMatch(e.html, /null|undefined/);
  assert.doesNotMatch(e.text, /null|undefined/);
});

test('dates are escaped into the HTML, never interpolated raw', () => {
  const e = pauseBookedEmail({ from: '<script>x</script>', until: '1 Jan 2027' });
  assert.doesNotMatch(e.html, /<script>/);
  assert.match(e.html, /&lt;script&gt;/);
});
