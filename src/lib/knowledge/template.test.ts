import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bareText, conditionCombos, parseTemplate, renderParsed, sentenceCount, tidy } from './template.ts';

const vals: Record<string, string> = { price: '£4', name: 'Sam' };
const value = (n: string) => vals[n] ?? null;

test('placeholders and sections parse and render', () => {
  const p = parseTemplate('A Full analysis is {price}{#welcome} ({price} until Friday){/welcome}.{^live} Not yet.{/live}');
  assert.ok(p.ok);
  assert.deepEqual(p.placeholders, ['price']);
  assert.deepEqual(p.conditions.sort(), ['live', 'welcome']);
  const on = renderParsed(p.parts, value, (c) => (c === 'welcome' ? true : true));
  assert.deepEqual(on, { ok: true, text: 'A Full analysis is £4 (£4 until Friday).' });
  const off = renderParsed(p.parts, value, () => false);
  assert.deepEqual(off, { ok: true, text: 'A Full analysis is £4. Not yet.' });
});

test('a placeholder in a hidden section need not resolve; a shown one must', () => {
  const p = parseTemplate('Hi{#named} {who}{/named}.');
  assert.ok(p.ok);
  assert.deepEqual(renderParsed(p.parts, value, () => false), { ok: true, text: 'Hi.' });
  assert.deepEqual(renderParsed(p.parts, value, () => true), { ok: false, missing: ['who'] });
});

test('an unresolved condition fails the render', () => {
  const p = parseTemplate('x{#c}y{/c}');
  assert.ok(p.ok);
  assert.deepEqual(renderParsed(p.parts, value, () => null), { ok: false, missing: ['c'] });
});

test('stray braces, unclosed and nested sections are errors', () => {
  assert.equal(parseTemplate('Costs {Price}').ok, false);
  assert.equal(parseTemplate('Costs {price').ok, false);
  assert.equal(parseTemplate('{#a}x').ok, false);
  assert.equal(parseTemplate('{#a}{#b}x{/b}{/a}').ok, false);
  assert.equal(parseTemplate('{/a}').ok, false);
  assert.equal(parseTemplate('{#a}x{/b}').ok, false);
});

test('bare text drops placeholders and markers but keeps section text', () => {
  const p = parseTemplate('From {price}{#a} or £5{/a}.');
  assert.ok(p.ok);
  assert.equal(bareText(p.parts).replace(/\s+/g, ' '), 'From or £5.');
});

test('combos, sentences and tidy', () => {
  assert.equal(conditionCombos(['a', 'b']).length, 4);
  assert.equal(conditionCombos(['a', 'b', 'c', 'd', 'e', 'f']).length, 16);
  assert.equal(sentenceCount('It is £2.17. It opens the deal.'), 2);
  assert.equal(sentenceCount('No full stop'), 1);
  assert.equal(sentenceCount('Yes! Really? Fine.'), 3);
  assert.equal(tidy('A  b ,c ( d ) .'), 'A b,c (d).');
});
