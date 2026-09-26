import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dailyNoticeEmail } from './daily-notice.ts'

test('the daily-picks notice says picks are daily and links to the Notifications panel to switch them off', () => {
  const m = dailyNoticeEmail({ siteUrl: 'https://intelligence.stayful.co.uk/', firstName: 'Sam' })
  assert.equal(m.subject, 'Your Stayful picks are now daily')
  assert.ok(m.text.startsWith('Hi Sam,'))
  assert.match(m.text, /one property pick a day, whatever plan you are on/)
  assert.ok(m.text.includes('Manage notifications: https://intelligence.stayful.co.uk/account/notifications'))
  assert.ok(m.html.includes('href="https://intelligence.stayful.co.uk/account/notifications"'))
  assert.ok(m.html.includes('>Manage notifications</a>'))
  assert.ok(m.text.includes('https://intelligence.stayful.co.uk/picks'))
})

test('no name, no awkward greeting; nothing is left unescaped', () => {
  const m = dailyNoticeEmail({ siteUrl: 'https://x.test', firstName: null })
  assert.ok(m.text.startsWith('Hi,'))
  assert.ok(m.html.includes('<p style="margin:0 0 14px">Hi,</p>'))
  const evil = dailyNoticeEmail({ siteUrl: 'https://x.test', firstName: '<b>' })
  assert.ok(!evil.html.includes('<b>'))
  assert.ok(evil.html.includes('&lt;b&gt;'))
})
