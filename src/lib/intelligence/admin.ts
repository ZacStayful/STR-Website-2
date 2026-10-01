/**
 * Batch 22: the /admin/intelligence figures, from rows. Pure: tested.
 */
export interface RevealFacts {
  viewed_at: string | null;
  first_keep_ms: number | null;
  strong: boolean;
  no_match: boolean;
  layer: number | null;
}

export interface SearchFacts {
  purpose: 'signup' | 'deep';
  status: string;
  raw_pence: number;
  charged_base_pence: number;
  found: number;
  confirmed: number;
}

export interface IntelligenceStats {
  reveals: number;
  viewed: number;
  medianFirstKeepMs: number | null;
  under10s: number | null;
  strongShare: number | null;
  noMatchShare: number | null;
  byLayer: Record<string, number>;
  signupSearches: { runs: number; rawPence: number; perSignupPence: number | null; finds: number };
  deepSearches: { runs: number; rawPence: number; revenuePence: number; finds: number };
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const share = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function intelligenceStats(reveals: readonly RevealFacts[], searches: readonly SearchFacts[]): IntelligenceStats {
  const viewed = reveals.filter((r) => r.viewed_at);
  const keeps = viewed.map((r) => r.first_keep_ms).filter((x): x is number => typeof x === 'number' && x >= 0);
  const byLayer: Record<string, number> = {};
  for (const r of viewed) {
    const k = r.no_match ? 'none' : r.layer === null ? 'stock' : `layer ${r.layer}`;
    byLayer[k] = (byLayer[k] ?? 0) + 1;
  }
  const signup = searches.filter((s) => s.purpose === 'signup');
  const deep = searches.filter((s) => s.purpose === 'deep');
  const sum = (xs: readonly SearchFacts[], f: (s: SearchFacts) => number) => Math.round(xs.reduce((a, s) => a + (Number(f(s)) || 0), 0) * 100) / 100;
  return {
    reveals: reveals.length,
    viewed: viewed.length,
    medianFirstKeepMs: median(keeps),
    under10s: keeps.length ? share(keeps.filter((k) => k < 10_000).length, keeps.length) : null,
    strongShare: share(viewed.filter((r) => r.strong).length, viewed.length),
    noMatchShare: share(viewed.filter((r) => r.no_match).length, viewed.length),
    byLayer,
    signupSearches: { runs: signup.length, rawPence: sum(signup, (s) => s.raw_pence), perSignupPence: reveals.length ? Math.round((sum(signup, (s) => s.raw_pence) / reveals.length) * 100) / 100 : null, finds: sum(signup, (s) => s.found) },
    deepSearches: { runs: deep.length, rawPence: sum(deep, (s) => s.raw_pence), revenuePence: sum(deep, (s) => s.charged_base_pence), finds: sum(deep, (s) => s.found) },
  };
}
