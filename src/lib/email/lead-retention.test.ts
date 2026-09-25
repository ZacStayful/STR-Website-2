import { test } from 'node:test'
import assert from 'node:assert/strict'
import { archiveWarningEmail, archivedEmail, type RetentionLead } from './lead-retention.ts'

const lead = (i: number, over: Partial<RetentionLead> = {}): RetentionLead => ({
  name: `Person ${i}`,
  email: `p${i}@example.com`,
  address: `${i} High Street, York`,
  createdAt: '2026-03-04T09:30:00.000Z',
  ...over,
})

test('the warning names the date, the leads and how to keep them', () => {
  const e = archiveWarningEmail({ leads: [lead(1), lead(2)], archiveOn: '2026-09-27T02:15:00Z' })
  assert.match(e.subject, /2 leads will be archived on 27 Sept? 2026/)
  assert.match(e.text, /Person 1 · 1 High Street, York · enquired 4 Mar 2026/)
  assert.match(e.text, /open it in Leads/)
  assert.match(e.text, /stop working once a lead is deleted/)
  assert.match(e.html, /\/leads"/)
})

test('the archived email gives the deletion date and links to the Archived tab', () => {
  const e = archivedEmail({ leads: [lead(1)], deleteOn: '2026-10-04T02:15:00Z' })
  assert.match(e.subject, /^1 lead archived — deleted on 4 Oct 2026 unless restored$/)
  assert.match(e.html, /\/leads\?tab=archived/)
  assert.match(e.text, /This lead was archived/)
})

test('a long batch lists ten and counts the rest', () => {
  const e = archivedEmail({ leads: Array.from({ length: 14 }, (_, i) => lead(i)), deleteOn: '2026-10-04T02:15:00Z' })
  assert.equal((e.text.match(/^- /gm) ?? []).length, 10)
  assert.match(e.text, /…and 4 more\./)
})

test('whatever a stranger typed into the funnel is escaped', () => {
  const e = archivedEmail({
    leads: [lead(1, { name: '<img src=x onerror=alert(1)>', address: '"><script>x</script>' })],
    deleteOn: '2026-10-04T02:15:00Z',
  })
  assert.ok(!e.html.includes('<img src=x'))
  assert.ok(!e.html.includes('<script>'))
})

test('a lead with no name falls back to its email, then to a neutral label', () => {
  const e = archiveWarningEmail({
    leads: [lead(1, { name: null }), lead(2, { name: ' ', email: null })],
    archiveOn: '2026-09-27T02:15:00Z',
  })
  assert.match(e.text, /- p1@example\.com/)
  assert.match(e.text, /- Unnamed enquiry/)
})
