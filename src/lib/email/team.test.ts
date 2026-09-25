import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inviteEmail, memberJoinedEmail, joinBlockedByCreditEmail, seatSuspendedEmail, seatRestoredEmail, memberRemovedEmail,
} from './team.ts'

test('the invite names the team and inviter, carries the link and the expiry', () => {
  const e = inviteEmail({ teamName: 'Northern Lets', inviterName: 'Zac', url: 'https://stayful.co.uk/team/join?token=abc', expiresOn: '2 Oct 2026' })
  assert.equal(e.subject, 'Zac invited you to join Northern Lets on Stayful')
  assert.match(e.html, /href="https:\/\/stayful\.co\.uk\/team\/join\?token=abc"/)
  assert.match(e.text, /until 2 Oct 2026/)
})

test('names typed by customers are escaped', () => {
  const e = inviteEmail({ teamName: '<script>x</script>', inviterName: '<img src=x>', url: 'https://x/y', expiresOn: 'soon' })
  assert.ok(!e.html.includes('<script>'))
  assert.ok(!e.html.includes('<img src=x>'))
})

test('the owner is told the price and the next charge date when someone joins', () => {
  const e = memberJoinedEmail({ memberName: 'Sam', nextChargeOn: '25 Oct 2026' })
  assert.match(e.text, /£10 a month/)
  assert.match(e.text, /25 Oct 2026/)
})

test('a join blocked by credit points the owner at top-up', () => {
  assert.match(joinBlockedByCreditEmail({ memberEmail: 'sam@x.com' }).html, /\/account\/billing/)
})

test('suspension and restoration address owner and member differently', () => {
  const o = seatSuspendedEmail({ to: 'owner', memberName: 'Sam', teamName: 'Northern Lets' })
  const m = seatSuspendedEmail({ to: 'member', memberName: 'Sam', teamName: 'Northern Lets' })
  assert.match(o.text, /Top up/)
  assert.doesNotMatch(m.html, /account\/billing/, 'a member has no billing page to go to')
  assert.match(seatRestoredEmail({ to: 'member', memberName: 'Sam', teamName: 'Northern Lets' }).subject, /is back/)
})

test('removal says whether the login was deleted', () => {
  const deleted = memberRemovedEmail({ to: 'member', memberName: 'Sam', teamName: 'Northern Lets', by: 'owner', loginDeleted: true })
  const kept = memberRemovedEmail({ to: 'member', memberName: 'Sam', teamName: 'Northern Lets', by: 'member', loginDeleted: false })
  assert.match(deleted.text, /has been deleted/)
  assert.match(kept.text, /unchanged/)
  assert.match(memberRemovedEmail({ to: 'owner', memberName: 'Sam', teamName: 'T', by: 'member', loginDeleted: false }).subject, /Sam left your team/)
})
