/**
 * Tiny, dependency-free helpers for pulling embedded data out of listing
 * pages. We never parse the DOM: every site we support embeds a JSON blob,
 * so a few string scans are enough and far more robust than selectors.
 */

/** Extracts one balanced JSON object/array starting at `start` (a `{` or `[`). */
export function extractBalancedJson(text: string, start: number): string | null {
  if (start < 0 || start >= text.length) return null;
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** JSON that follows an assignment such as `window.PAGE_MODEL = {...}`. */
export function jsonAfter(text: string, marker: string): unknown | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const brace = text.indexOf('{', at + marker.length);
  const bracket = text.indexOf('[', at + marker.length);
  const candidates = [brace, bracket].filter((n) => n >= 0);
  if (candidates.length === 0) return null;
  const start = Math.min(...candidates);
  // Guard against a marker that is followed by unrelated code much later.
  if (start - (at + marker.length) > 64) return null;
  const raw = extractBalancedJson(text, start);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Contents of `<script id="..." ...>...</script>` parsed as JSON. */
export function scriptJsonById(html: string, id: string): unknown | null {
  const re = new RegExp(`<script[^>]*\\sid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

/** All `<script type="application/ld+json">` blocks that parse. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* skip malformed block */
    }
  }
  return out;
}

export function metaContent(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]*(?:property|name|itemprop)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${esc}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1]) : null;
}

export function titleOf(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', middot: '·', hellip: '…',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', euro: '€',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/** Depth-first search for the first object satisfying `pred`. */
export function findNode(root: unknown, pred: (o: Record<string, unknown>) => boolean, maxDepth = 24): Record<string, unknown> | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > maxDepth || !node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    if (!Array.isArray(node) && pred(node as Record<string, unknown>)) return node as Record<string, unknown>;
    for (const child of Object.values(node as Record<string, unknown>)) {
      const hit = walk(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, 0);
}

/** "£1,195 pcm" → { amount: 1195, period: 'pcm' }; "£220,000" → total. */
export function parsePrice(text: string | null | undefined): { amount: number; period: 'total' | 'pcm' | 'pw' | 'night' } | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/£\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const lower = text.toLowerCase();
  const period = /\bpcm\b|per month|\/ ?month/.test(lower)
    ? 'pcm'
    : /\bpw\b|per week|\/ ?week/.test(lower)
      ? 'pw'
      : /night/.test(lower)
        ? 'night'
        : 'total';
  return { amount, period };
}

/** Postcode helpers shared by the parsers. */
const FULL_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const OUTCODE_ONLY = /\b([A-Z]{1,2}\d[A-Z\d]?)\b/i;

export function findPostcode(text: string | null | undefined): { postcode: string; outcode: string } | null {
  if (!text) return null;
  const m = text.match(FULL_POSTCODE);
  if (!m) return null;
  const outcode = m[1].toUpperCase();
  return { postcode: `${outcode} ${m[2].toUpperCase()}`, outcode };
}

export function findOutcode(text: string | null | undefined): string | null {
  if (!text) return null;
  // Prefer a full postcode's outcode; otherwise the last token that looks like one.
  const full = findPostcode(text);
  if (full) return full.outcode;
  const tokens = text.split(/[\s,]+/).reverse();
  for (const t of tokens) {
    const m = t.match(OUTCODE_ONLY);
    if (m && m[0].length === t.length && /\d/.test(t)) return t.toUpperCase();
  }
  return null;
}
