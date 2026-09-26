import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKeyword, keywordFromOptOutType } from './keywords.ts';

test('every opt-out keyword stops, whatever the case or punctuation', () => {
  for (const body of ['STOP', 'stop', ' Stop. ', 'STOPALL', 'stop all', 'Unsubscribe', 'CANCEL', 'end', 'quit', 'OPTOUT', 'opt out', 'revoke', 'STOP!']) {
    assert.equal(classifyKeyword(body), 'stop', body);
  }
});

test('STOP, UNSUBSCRIBE and OPT OUT stop wherever they are in the text', () => {
  assert.equal(classifyKeyword('Stop texting me please'), 'stop');
  assert.equal(classifyKeyword('Please stop'), 'stop');
  assert.equal(classifyKeyword('unsubscribe me'), 'stop');
  assert.equal(classifyKeyword('I want to opt out of these'), 'stop');
  assert.equal(classifyKeyword('please STOPALL'), 'stop');
});

test('CANCEL, END, QUIT and REVOKE stop only when they open the text', () => {
  assert.equal(classifyKeyword('Cancel'), 'stop');
  assert.equal(classifyKeyword('End these texts'), 'stop');
  assert.equal(classifyKeyword("I'll cancel the viewing"), null);
  assert.equal(classifyKeyword('At the end of the day'), null);
});

test('START, UNSTOP and YES start again, but only on their own', () => {
  assert.equal(classifyKeyword('START'), 'start');
  assert.equal(classifyKeyword('unstop'), 'start');
  assert.equal(classifyKeyword('Yes'), 'start');
  assert.equal(classifyKeyword('yes please call me'), null);
  assert.equal(classifyKeyword('start again tomorrow'), null);
});

test('HELP and INFO ask for help', () => {
  assert.equal(classifyKeyword('help'), 'help');
  assert.equal(classifyKeyword('INFO'), 'help');
});

test('anything else is nothing', () => {
  assert.equal(classifyKeyword('Thanks, is the flat still available?'), null);
  assert.equal(classifyKeyword('Is it a bus stopover?'), null); // STOPOVER is not STOP
  assert.equal(classifyKeyword(''), null);
  assert.equal(classifyKeyword(null), null);
  assert.equal(classifyKeyword('😀'), null);
});

test('OptOutType maps to the same keywords', () => {
  assert.equal(keywordFromOptOutType('STOP'), 'stop');
  assert.equal(keywordFromOptOutType('start'), 'start');
  assert.equal(keywordFromOptOutType('HELP'), 'help');
  assert.equal(keywordFromOptOutType(''), null);
  assert.equal(keywordFromOptOutType(null), null);
});
