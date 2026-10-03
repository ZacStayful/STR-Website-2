/**
 * Batch 24: which approved answer a typed (or transcribed) question is
 * asking for, and how sure we are.
 *
 * Plain lexical matching, in memory: the approved set is tens to a few
 * hundred entries, read fresh, so there is no index to keep and the result
 * is the same every time (and testable). Each phrasing of an entry (its
 * question and every "other way people ask it") is scored on its own and the
 * entry takes its best, so adding phrasings can only help. Scores are TF-IDF
 * cosines in 0..1:
 *   - text is normalised first: lower case, joined compounds ("top up" →
 *     topup, "p m i" → pmi), stop words dropped, light stemming, synonyms
 *     folded (cost / price / fee …);
 *   - a word the knowledge base has never seen still counts against the
 *     score (at the average word's weight), so "can I bring my dog" doesn't
 *     match an entry on the strength of one shared word;
 *   - the best entry must lead the second by MATCH_MIN_LEAD to count as
 *     answered, so two near-equal entries make it low confidence.
 * The thresholds are billing_settings (si_kb_answer_min_confidence,
 * si_kb_low_confidence_min).
 *
 * Embeddings (pgvector) were left out deliberately: they need an embeddings
 * provider and re-embedding on every edit, and nothing yet shows lexical
 * matching falls short. Coverage (/admin/intelligence/coverage) is where
 * that would show: questions logged as not answered that an approved entry
 * did cover.
 *
 * Pure: no network, no database, no server-only.
 */
import { COMPOUNDS, MATCH_MAX_RESULTS, MATCH_MIN_LEAD, STOPWORDS, SYNONYMS } from './config.ts';

export interface Matchable {
  id: string;
  slug: string;
  version: number;
  question: string;
  variants: readonly string[];
  channels: readonly string[];
}

export type MatchOutcome = 'answered' | 'low_confidence' | 'could_not_answer';

export interface Match {
  entryId: string;
  slug: string;
  version: number;
  /** 0..1 */
  confidence: number;
  /** The phrasing that matched best. */
  phrasing: string;
}

export interface MatchResult {
  outcome: MatchOutcome;
  /** Best first, at most `limit`, only those above zero. */
  matches: Match[];
}

const NUMBER_WORDS: Record<string, string> = { two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/** A light English stemmer: enough to fold plurals and common endings, never clever. */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('yses')) return w.slice(0, -4) + 'ysis';
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (/(ches|shes|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  return w;
}

/** The tokens a phrasing or question is compared on. */
export function tokens(text: string): string[] {
  let s = text
    .toLowerCase()
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[’‘`]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/n't\b/g, ' not');
  for (const [re, to] of COMPOUNDS) s = s.replace(re, ` ${to} `);
  const out: string[] = [];
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    const w = NUMBER_WORDS[raw] ?? raw;
    if (STOPWORDS.has(w)) continue;
    const syn = SYNONYMS[w] ?? SYNONYMS[stem(w)] ?? stem(w);
    if (!syn || STOPWORDS.has(syn)) continue;
    out.push(syn);
  }
  return out;
}

interface Doc {
  entry: Matchable;
  phrasing: string;
  tf: Map<string, number>;
}

const termFreq = (ts: readonly string[]): Map<string, number> => {
  const tf = new Map<string, number>();
  for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
};

/** A prepared index over the entries, so many questions can be matched against one build. */
export interface MatchIndex {
  docs: Doc[];
  idf: Map<string, number>;
  /** The average weight a known word has: what an unknown word in a question weighs. */
  unknownWeight: number;
}

export function buildIndex(entries: readonly Matchable[], channel?: string): MatchIndex {
  const docs: Doc[] = [];
  for (const e of entries) {
    if (channel && !e.channels.includes(channel)) continue;
    for (const phrasing of [e.question, ...e.variants]) {
      const ts = tokens(phrasing);
      if (ts.length) docs.push({ entry: e, phrasing, tf: termFreq(ts) });
    }
  }
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  // Smoothed, so a word in every phrasing still weighs a little and a tiny corpus doesn't swing wildly.
  for (const [t, f] of df) idf.set(t, Math.log(1 + (n + 1) / (f + 0.5)));
  const avg = idf.size ? [...idf.values()].reduce((a, b) => a + b, 0) / idf.size : 1;
  return { docs, idf, unknownWeight: avg };
}

const weight = (tf: number, idf: number) => (1 + Math.log(tf)) * idf;

function cosine(q: Map<string, number>, d: Map<string, number>, index: MatchIndex): number {
  let dot = 0;
  let qn = 0;
  for (const [t, f] of q) {
    const idf = index.idf.get(t);
    const qw = idf === undefined ? weight(f, index.unknownWeight) : weight(f, idf);
    qn += qw * qw;
    const df = d.get(t);
    if (idf !== undefined && df !== undefined) dot += qw * weight(df, idf);
  }
  let dn = 0;
  for (const [t, f] of d) {
    const w = weight(f, index.idf.get(t) ?? 0);
    dn += w * w;
  }
  return qn > 0 && dn > 0 ? dot / Math.sqrt(qn * dn) : 0;
}

export interface MatchOptions {
  /** At or above: answered (if it leads the next entry by MATCH_MIN_LEAD). */
  answerMin: number;
  /** At or above: low confidence. Below: could not answer. */
  lowMin: number;
  limit?: number;
}

export function matchIndex(index: MatchIndex, question: string, o: MatchOptions): MatchResult {
  const q = termFreq(tokens(question));
  if (q.size === 0 || index.docs.length === 0) return { outcome: 'could_not_answer', matches: [] };
  const best = new Map<string, Match>();
  for (const d of index.docs) {
    const c = cosine(q, d.tf, index);
    if (c <= 0) continue;
    const prev = best.get(d.entry.id);
    if (!prev || c > prev.confidence) best.set(d.entry.id, { entryId: d.entry.id, slug: d.entry.slug, version: d.entry.version, confidence: Math.round(c * 1000) / 1000, phrasing: d.phrasing });
  }
  const matches = [...best.values()].sort((a, b) => b.confidence - a.confidence || a.slug.localeCompare(b.slug)).slice(0, o.limit ?? MATCH_MAX_RESULTS);
  const top = matches[0]?.confidence ?? 0;
  const second = matches[1]?.confidence ?? 0;
  const outcome: MatchOutcome = top >= o.answerMin && top - second >= MATCH_MIN_LEAD ? 'answered' : top >= o.lowMin ? 'low_confidence' : 'could_not_answer';
  return { outcome, matches };
}

/**
 * The best approved entries for a question, with a confidence score each and
 * the outcome. Pass only live entries (si_knowledge_live); `channel` keeps
 * to the entries allowed there.
 */
export function matchKnowledge(entries: readonly Matchable[], question: string, o: MatchOptions & { channel?: string }): MatchResult {
  return matchIndex(buildIndex(entries, o.channel), question, o);
}
