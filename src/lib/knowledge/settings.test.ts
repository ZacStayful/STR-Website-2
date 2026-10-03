import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_KNOWLEDGE_SETTINGS, KNOWLEDGE_SETTING_KEYS, parseKnowledgeSettings, poundsToPence, validateGapForm, validateKnowledgeForm } from './settings.ts';

const form = (o: Record<string, string>) => (name: string) => (name in o ? o[name] : null);

test('missing or bad rows take the defaults', () => {
  assert.deepEqual(parseKnowledgeSettings(new Map()), DEFAULT_KNOWLEDGE_SETTINGS);
  const s = parseKnowledgeSettings(new Map<string, unknown>([['si_gap_max_groups_per_night', 2.5], ['si_facts_max', -1], ['si_gap_monthly_cap_pence', '900']]));
  assert.equal(s.gapMaxGroupsPerNight, 20);
  assert.equal(s.factsMax, 30);
  assert.equal(s.gapMonthlyCapPence, 900);
});

test('retention can never be set under a year', () => {
  assert.equal(parseKnowledgeSettings(new Map([['si_question_retention_months', 3]])).questionRetentionMonths, 24);
});

test('thresholds out of order fall back together', () => {
  const s = parseKnowledgeSettings(new Map([['si_kb_answer_min_confidence', 0.3], ['si_kb_low_confidence_min', 0.4]]));
  assert.equal(s.answerMinConfidence, 0.55);
  assert.equal(s.lowConfidenceMin, 0.3);
});

test('the knowledge form needs the floor below the threshold', () => {
  const bad = validateKnowledgeForm(form({ answerMinConfidence: '0.4', lowConfidenceMin: '0.5', factsMax: '30', questionRetentionMonths: '24' }));
  assert.equal(bad.ok, false);
  const good = validateKnowledgeForm(form({ answerMinConfidence: '0.6', lowConfidenceMin: '0.25', factsMax: '10', questionRetentionMonths: '24' }));
  assert.deepEqual(good, { ok: true, settings: { answerMinConfidence: 0.6, lowConfidenceMin: 0.25, factsMax: 10, questionRetentionMonths: 24 } });
});

test('the gap form takes the cap in pounds', () => {
  const r = validateGapForm(form({ gapMaxGroupsPerNight: '20', gapMaxQuestions: '200', gapMonthlyCapPounds: '£15' }));
  assert.deepEqual(r, { ok: true, settings: { gapMaxGroupsPerNight: 20, gapMaxQuestions: 200, gapMonthlyCapPence: 1500 } });
  assert.equal(validateGapForm(form({ gapMaxGroupsPerNight: '20', gapMaxQuestions: '200', gapMonthlyCapPounds: 'lots' })).ok, false);
  assert.equal(poundsToPence('1,000.5'), 100050);
});

test('every setting is seeded in supabase/schema.sql with its default', () => {
  const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  for (const [field, key] of Object.entries(KNOWLEDGE_SETTING_KEYS)) {
    const m = sql.match(new RegExp(`\\('${key}',\\s*'([^']*)'::jsonb\\)`));
    assert.ok(m, `${key} is not seeded`);
    assert.equal(Number(m[1]), DEFAULT_KNOWLEDGE_SETTINGS[field as keyof typeof DEFAULT_KNOWLEDGE_SETTINGS], key);
  }
});

test('the gap job prompt-cache unit rows are in the code seed and the schema seed', async () => {
  const { UNIT_COST_SEED } = await import('../credit/costs.ts');
  const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  for (const unit of ['haiku45_cache_read_token', 'haiku45_cache_write_token', 'sonnet55_cache_read_token', 'sonnet55_cache_write_token']) {
    const row = UNIT_COST_SEED.find((r) => r.provider === 'anthropic' && r.unit === unit);
    assert.ok(row, unit);
    const m = sql.match(new RegExp(`\\('anthropic', '${unit}', '[^']*', ([0-9.]+),`));
    assert.ok(m, `${unit} is not seeded in schema.sql`);
    assert.ok(Math.abs(Number(m[1]) - row.unitCostPence) < 1e-9, unit);
  }
});
