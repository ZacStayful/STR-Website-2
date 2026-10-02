import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS, CORE, FALLBACK_VOICE_ID, PERSONA_VERSION, buildSystemPrompt, voiceId, type PersonaChannel } from './stayful-intelligence.ts';
import { cleanForSpeech } from './clean.ts';

const channels = Object.keys(CHANNELS) as PersonaChannel[];

test('the version label is set', () => {
  assert.match(PERSONA_VERSION, /^si-voice-v\d+$/);
});

test('every channel prompt carries every CORE rule and only its own channel block (full and compact)', () => {
  for (const compact of [false, true]) {
    for (const ch of channels) {
      const p = buildSystemPrompt(ch, undefined, { compact });
      for (const r of CORE) assert.ok(p.includes(compact ? r.compact : r.full), `${ch} missing CORE ${r.id}`);
      for (const r of CHANNELS[ch]) assert.ok(p.includes(compact ? r.compact : r.full), `${ch} missing ${r.id}`);
      for (const other of channels.filter((c) => c !== ch)) {
        for (const r of CHANNELS[other]) {
          if (CHANNELS[ch].some((own) => own.full === r.full)) continue;
          assert.ok(!p.includes(compact ? r.compact : r.full), `${ch} includes ${other}'s ${r.id}`);
        }
      }
    }
  }
});

test('the phone block has the no-address / no-figures rule', () => {
  const p = buildSystemPrompt('phone');
  assert.match(p, /Never read out an address, exact figures, a balance or card details/);
  assert.match(p, /caller ID can be faked/);
  assert.match(p, /Never text any other number/);
  assert.match(p, /I don't know that one yet — I've passed it to the team/);
});

test('the core rules name the persona, the AI honesty rule and no advice', () => {
  const p = buildSystemPrompt('chat');
  assert.match(p, /You are Stayful Intelligence/);
  assert.match(p, /say no/);
  assert.match(p, /never give financial, mortgage or legal advice/);
  assert.match(p, /Never guarantee income/);
});

test('the task text is appended after the rules', () => {
  const p = buildSystemPrompt('in_app_spoken', 'Summarise this.', { compact: true });
  assert.ok(p.endsWith('Summarise this.'));
});

test('voiceId: the env var wins; blank falls back to the chosen voice, never Rachel', () => {
  assert.equal(voiceId({ ELEVENLABS_VOICE_ID: 'abc123' }), 'abc123');
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(voiceId({ ELEVENLABS_VOICE_ID: '  ' }), FALLBACK_VOICE_ID);
    assert.equal(voiceId({}), FALLBACK_VOICE_ID);
  } finally {
    console.warn = warn;
  }
  assert.notEqual(FALLBACK_VOICE_ID, '21m00Tcm4TlvDq8ikWAM');
});

test('voiceId warns at most once a day', () => {
  const warn = console.warn;
  let n = 0;
  console.warn = () => { n += 1; };
  try {
    voiceId({}, new Date('2031-01-01T08:00:00Z'));
    voiceId({}, new Date('2031-01-01T18:00:00Z'));
    assert.equal(n, 1);
    voiceId({}, new Date('2031-01-02T08:00:00Z'));
    assert.equal(n, 2);
  } finally {
    console.warn = warn;
  }
});

test('cleanForSpeech strips markdown and emoji', () => {
  assert.equal(cleanForSpeech('**Strong.** This looks _good_ 🚀🏠 — about £8,400 a year.'), 'Strong. This looks good — about £8,400 a year.');
  assert.equal(cleanForSpeech('# Verdict\n- one\n- two\n1. three'), 'Verdict one two three');
  assert.equal(cleanForSpeech('See [the comps](https://x.y) and `code`.'), 'See the comps and code.');
  assert.equal(cleanForSpeech('Plain text stays: about £700 a month, 62% occupancy.'), 'Plain text stays: about £700 a month, 62% occupancy.');
  assert.equal(cleanForSpeech('Flags 🇬🇧 and ❤️ go.'), 'Flags and go.');
});
