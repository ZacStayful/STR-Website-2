import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHashWith, agentHash, normaliseAgentName } from './agent.ts';

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
  assert.match(h, /^[A-Za-z0-9_-]{22}$/);
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
