import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHashWith, agentHash, agentHashDiffers, agentKeyFingerprint, normaliseAgentName } from './agent.ts';

const key = 'test-key-not-a-real-one';

test('the same agent hashes the same way, a different one does not', () => {
  assert.equal(agentHashWith(key, 'Foxtons'), agentHashWith(key, 'Foxtons'));
  assert.notEqual(agentHashWith(key, 'Foxtons'), agentHashWith(key, 'Savills'));
});

test('cosmetic differences are not a new agent', () => {
  // A relist under the same brand must not read as "relisted with a new agent".
  const base = agentHashWith(key, 'Smith & Co Estate Agents');
  for (const variant of ['smith and co estate agents', 'Smith & Co. Estate Agents Ltd', 'SMITH AND CO  ESTATES']) {
    assert.equal(agentHashWith(key, variant), base, variant);
  }
});

test('a different key gives a different digest', () => {
  assert.notEqual(agentHashWith(key, 'Foxtons'), agentHashWith('another-key', 'Foxtons'));
});

test('the name never appears in the digest', () => {
  const h = agentHashWith(key, 'Foxtons')!;
  assert.doesNotMatch(h.toLowerCase(), /foxton/);
  assert.match(h, /^[A-Za-z0-9_-]{4}\.[A-Za-z0-9_-]{22}$/);
});

test('the digest carries the fingerprint of the key that made it', () => {
  assert.equal(agentHashWith(key, 'Foxtons')!.split('.')[0], agentKeyFingerprint(key));
  assert.notEqual(agentKeyFingerprint(key), agentKeyFingerprint('another-key'));
  assert.equal(agentKeyFingerprint(key), agentKeyFingerprint(key));
});

test('two digests are only compared when the same key made them', () => {
  const mine = agentHashWith(key, 'Foxtons')!;
  const other = agentHashWith(key, 'Savills')!;
  assert.ok(agentHashDiffers(mine, other));
  assert.ok(!agentHashDiffers(mine, mine));

  // Half a pair is us learning the agent, not the seller changing it.
  for (const [a, b] of [[null, mine], [mine, null], [undefined, mine], [mine, undefined]] as const) {
    assert.ok(!agentHashDiffers(a, b), `${a} vs ${b}`);
  }

  // A rotated key re-digests every agent at once. Without the fingerprint that
  // would read as every seller in the country changing agent on the same day.
  const rotated = agentHashWith('the-next-key', 'Foxtons')!;
  assert.notEqual(rotated, mine);
  assert.ok(!agentHashDiffers(mine, rotated));

  // A digest stored before the format carried a fingerprint is likewise unknown.
  assert.ok(!agentHashDiffers('22charsofbase64urlaaaa', mine));
});

test('nothing usable gives no signal rather than a bogus one', () => {
  for (const v of [null, undefined, '', '   ', 'Ltd', 'The Estate Agents']) {
    assert.equal(agentHashWith(key, v), null, JSON.stringify(v));
  }
});

test('normalisation keeps the distinguishing part of the name', () => {
  assert.equal(normaliseAgentName('Smith & Co Estate Agents Ltd'), 'smith and co');
});

test('without a key the signal is dropped, never hashed unsalted', () => {
  const had = process.env.AGENT_HASH_KEY;
  delete process.env.AGENT_HASH_KEY;
  try {
    assert.equal(agentHash('Foxtons'), null);
    process.env.AGENT_HASH_KEY = key;
    assert.equal(agentHash('Foxtons'), agentHashWith(key, 'Foxtons'));
  } finally {
    if (had === undefined) delete process.env.AGENT_HASH_KEY;
    else process.env.AGENT_HASH_KEY = had;
  }
});
