/**
 * Guards on the next-step content (next-steps.ts), so an edit can never show
 * a member a blank, a raw {field}, content for the wrong kind of deal, or a
 * promise. Every message is rendered with every combination of its fields
 * missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_STEPS } from './next-steps.ts';
import { checkTemplate, fillTemplate, mailtoHref } from './render.ts';
import { MESSAGE_FIELDS, OFFER_FIELDS, type KindBlocks, type StageBlock } from './types.ts';

const STAGES = ['kept', 'contacted', 'viewing', 'offer', 'secured'] as const;
const KINDS = ['purchase', 'rentToRent'] as const;

/** Long, awkward values: commas, apostrophes, accents. */
const WORST: Record<string, string> = {
  address: "Flat 3, 12 O'Brien Court, Long Road, Newcastle upon Tyne, NE1 4AB",
  town: 'Newcastle upon Tyne',
  bedrooms: 'studio',
  askingPrice: '£1,250,000',
  askingRent: '£12,500 a month',
  timeOnMarket: 'at least 11 months',
  memberName: "Siobhán O'Brien-Smythe",
  offerAmount: '£1,249,000',
};

function subsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask += 1) out.push(items.filter((_, i) => mask & (1 << i)));
  return out;
}

function fieldsWith(present: readonly string[]): Record<string, string> {
  return Object.fromEntries(present.map((k) => [k, WORST[k]]));
}

const block = (stage: (typeof STAGES)[number], kind: (typeof KINDS)[number]): StageBlock => (NEXT_STEPS.stages[stage] as KindBlocks)[kind];

/** Every message (subject and body) with where it lives. */
function messages() {
  const out: { where: string; kind: (typeof KINDS)[number]; subject: string; body: string }[] = [];
  for (const stage of STAGES) for (const kind of KINDS) {
    const m = block(stage, kind).message;
    if (m) out.push({ where: `${stage}.${kind}`, kind, subject: m.subject, body: m.body });
  }
  return out;
}

/** Every string in the content, with its path. */
function allStrings(node: unknown, path = ''): { path: string; text: string }[] {
  if (typeof node === 'string') return [{ path, text: node }];
  if (Array.isArray(node)) return node.flatMap((n, i) => allStrings(n, `${path}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => allStrings(v, path ? `${path}.${k}` : k));
  return [];
}

function assertClean(text: string, where: string) {
  for (const bad of ['{', '}', '[', ']', 'undefined', 'null', 'NaN']) assert.ok(!text.includes(bad), `${where}: shows "${bad}"\n${text}`);
  assert.ok(!/ {2}/.test(text), `${where}: double space\n${text}`);
  assert.ok(!/ [,.;:?)]/.test(text), `${where}: space before punctuation\n${text}`);
  assert.ok(!/\n\n\n/.test(text), `${where}: more than one blank line\n${text}`);
  for (const line of text.split('\n')) {
    if (line === '') continue;
    assert.ok(!/^[\s\p{P}]*$/u.test(line), `${where}: a line of only punctuation\n${text}`);
    assert.ok(!/^(- )?[a-z]/.test(line), `${where}: a line starting in lower case: "${line}"`);
  }
}

test('every stage and kind has its heading, intro and tool', () => {
  for (const stage of STAGES) for (const kind of KINDS) {
    const b = block(stage, kind);
    assert.ok(b.heading.trim(), `${stage}.${kind} heading`);
    assert.ok(b.intro.trim(), `${stage}.${kind} intro`);
    if (stage === 'kept' || stage === 'contacted' || stage === 'offer') assert.ok(b.message?.body.trim(), `${stage}.${kind} needs a message`);
    if (stage === 'viewing' || stage === 'secured') assert.ok((b.checklist?.length ?? 0) > 0, `${stage}.${kind} needs a checklist`);
  }
  for (const [k, v] of Object.entries(NEXT_STEPS.moveButtons)) assert.ok(v.trim(), `move button ${k}`);
});

test('the template rules hold for every piece of content', () => {
  for (const { path, text } of allStrings(NEXT_STEPS)) {
    const offer = path.startsWith('offer.');
    const problems = checkTemplate(text, offer ? { allowed: OFFER_FIELDS, bareAllowed: true } : { allowed: MESSAGE_FIELDS, bareAllowed: false });
    assert.deepEqual(problems, [], `${path}: ${problems.join('; ')}`);
  }
});

test('offerAmount is only used in offer messages', () => {
  for (const { path, text } of allStrings(NEXT_STEPS.stages)) {
    if (text.includes('{offerAmount}')) assert.ok(path.startsWith('offer.') && path.includes('.message.'), `${path} uses {offerAmount}`);
  }
});

test('every message reads cleanly with every combination of fields missing', () => {
  const combos = subsets(MESSAGE_FIELDS);
  for (const m of messages()) {
    for (const present of combos) {
      const f = fieldsWith(present);
      const subject = fillTemplate(m.subject, f);
      const body = fillTemplate(m.body, f);
      assert.ok(subject.length > 0 && !subject.includes('\n'), `${m.where}: subject must be one non-empty line`);
      assertClean(subject, `${m.where} subject`);
      assertClean(body, `${m.where} body`);
      assert.ok(body.startsWith('Hello,'), `${m.where}: opens with the greeting`);
    }
  }
  const manage = NEXT_STEPS.manage.message;
  for (const present of combos) assertClean(fillTemplate(manage, fieldsWith(present)), 'manage.message');
});

test('a message with every field filled fits in a mail link', () => {
  for (const m of messages()) {
    const href = mailtoHref(fillTemplate(m.subject, WORST), fillTemplate(m.body, WORST));
    assert.ok(href.length < 1800, `${m.where}: mail link is ${href.length} characters`);
  }
});

test('rent-to-rent says plainly it is serviced accommodation and needs written consent', () => {
  for (const stage of ['kept', 'contacted', 'offer'] as const) {
    const m = block(stage, 'rentToRent').message!;
    const bare = fillTemplate(m.body, {});
    assert.match(bare, /serviced accommodation/i, `${stage}: serviced accommodation`);
    assert.match(bare, /written consent/i, `${stage}: written consent`);
  }
  const ids = block('viewing', 'rentToRent').checklist!.map((i) => i.id);
  assert.ok(ids.includes('written-consent'), 'the rent-to-rent viewing checklist asks for written consent');
});

test('the purchase enquiry asks the questions that matter for a short let', () => {
  const bare = fillTemplate(block('kept', 'purchase').message!.body, {});
  assert.match(bare, /viewing/i);
  assert.match(bare, /freehold or leasehold/i);
  assert.match(bare, /years are left on the lease/i);
  assert.match(bare, /short lets or subletting/i);
  assert.match(bare, /service charge and ground rent/i);
  assert.match(bare, /seller moving/i);
  assert.match(bare, /chain/i);
});

test('no content for the wrong kind of deal', () => {
  const purchase = allStrings(Object.fromEntries(STAGES.map((s) => [s, block(s, 'purchase')])));
  purchase.push(...allStrings(NEXT_STEPS.offer).filter((s) => s.path.endsWith('.purchase')));
  for (const { path, text } of purchase) assert.doesNotMatch(text, /rent[- ]to[- ]rent|company let|written consent|serviced accommodation/i, `purchase ${path}`);
  const rent = allStrings(Object.fromEntries(STAGES.map((s) => [s, block(s, 'rentToRent')])));
  rent.push(...allStrings(NEXT_STEPS.offer).filter((s) => s.path.endsWith('.rentToRent')));
  for (const { path, text } of rent) assert.doesNotMatch(text, /stamp duty|\bchain\b|\bvendor\b|freehold|leasehold|ground rent|mortgage|asking price/i, `rent-to-rent ${path}`);
});

test('no promises, no hype, no exclamation marks', () => {
  for (const { path, text } of allStrings(NEXT_STEPS)) {
    assert.ok(!text.includes('!'), `${path}: exclamation mark`);
    assert.doesNotMatch(text, /risk[- ]free|passive income|no[- ]brainer|100%|will make you|you will earn/i, `${path}: hype`);
  }
});

test('"guaranteed" appears only in a rent-to-rent message that spells out the commitment', () => {
  for (const { path, text } of allStrings(NEXT_STEPS)) {
    if (!/guarant/i.test(text)) continue;
    assert.ok(/^stages\.(kept|contacted|offer)\.rentToRent\.message\.body$/.test(path), `${path}: "guarantee" outside a rent-to-rent message`);
    assert.match(text, /whether or not the property is occupied/i, `${path}: says what the guarantee is`);
  }
});

test('messages to agents and landlords never mention Stayful', () => {
  for (const m of messages()) {
    assert.doesNotMatch(m.subject + m.body, /stayful/i, m.where);
  }
});

test('checklist ids are unique and safe to store', () => {
  for (const stage of ['viewing', 'secured'] as const) for (const kind of KINDS) {
    const ids = block(stage, kind).checklist!.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, `${stage}.${kind}: duplicate id`);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${stage}.${kind}: id "${id}"`);
    for (const item of block(stage, kind).checklist!) assert.ok(item.text.trim(), `${stage}.${kind}.${item.id}: no text`);
  }
  assert.ok(!block('viewing', 'purchase').checklist!.some((i) => i.id === 'written-consent'));
});

test('message ids are unique', () => {
  const ids = messages().map((m) => block(m.where.split('.')[0] as (typeof STAGES)[number], m.kind).message!.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

test('the offer range always carries the exact not-financial-advice label', () => {
  assert.equal(NEXT_STEPS.offer.disclaimer, "A guide based on your targets and this listing's history — not financial advice.");
});
