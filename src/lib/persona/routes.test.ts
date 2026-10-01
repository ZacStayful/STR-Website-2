import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNarratorDeal } from '../analysis/narrator-deal.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('summarise builds its prompt from the persona and has dropped the old framing', () => {
  const s = read('app/api/summarise/route.ts');
  assert.ok(!/landlord/i.test(s), 'still mentions landlord');
  assert.ok(!s.includes("Stayful's analyst"), "still says Stayful's analyst");
  assert.match(s, /buildSystemPrompt\("in_app_spoken"/);
  assert.match(s, /cleanForSpeech\(/);
  // The model and output ceiling are unchanged (the charge per summary stays the same).
  assert.match(s, /NARRATOR_MODEL = "claude-opus-4-8"/);
  assert.match(s, /NARRATOR_MAX_TOKENS = 600/);
});

test('speak reads the voice from the persona module, not its own default', () => {
  const s = read('app/api/speak/route.ts');
  assert.match(s, /from "@\/lib\/persona\/stayful-intelligence"/);
  assert.ok(!s.includes('21m00Tcm4TlvDq8ikWAM'), 'Rachel is still the default');
  assert.ok(!s.includes('process.env.ELEVENLABS_VOICE_ID'), 'reads the voice env var itself');
});

test('the narrator says Stayful Intelligence, not AI analyst', () => {
  const s = read('components/AnalyserNarrator.tsx');
  assert.ok(!/AI analyst/.test(s));
  assert.match(s, /Stayful Intelligence: talk me through this report/);
});

test('parseNarratorDeal keeps only well-formed deal context', () => {
  assert.equal(parseNarratorDeal(null), null);
  assert.equal(parseNarratorDeal({ type: 'str' }), null);
  assert.deepEqual(parseNarratorDeal({ type: 'purchase', amount: 185000.4, period: 'total' }), { type: 'purchase', amount: 185000, period: 'total' });
  assert.deepEqual(parseNarratorDeal({ type: 'r2r', amount: 950 }), { type: 'r2r', amount: 950, period: 'pcm' });
  assert.deepEqual(parseNarratorDeal({ type: 'r2r', amount: 'lots', period: 'pcm' }), { type: 'r2r' });
  assert.deepEqual(parseNarratorDeal({ type: 'purchase', amount: -1 }), { type: 'purchase' });
});
