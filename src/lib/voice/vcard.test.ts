import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVCard } from './vcard.ts';

test('the contact card names Stayful Intelligence with the number, in vCard 3.0', () => {
  const v = buildVCard({ tel: '+44 7700 900123', url: 'https://stayful.co.uk', photoPngBase64: 'A'.repeat(200) });
  assert.match(v, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(v, /\r\nFN:Stayful Intelligence\r\n/);
  assert.match(v, /\r\nTEL;TYPE=CELL,VOICE:\+447700900123\r\n/);
  assert.match(v, /END:VCARD\r\n$/);
  for (const line of v.split('\r\n')) assert.ok(line.length <= 75, `line too long: ${line.length}`);
  assert.match(v, /\r\n A/); // the photo is folded
});
