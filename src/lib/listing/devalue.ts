/**
 * Decoder for the flattened array format Rightmove now uses for
 * `window.PAGE_MODEL.data` (the same shape SvelteKit's `devalue` produces):
 * index 0 is the root; objects map keys to indices; arrays hold indices;
 * primitives are stored inline; a few negative numbers stand for special
 * values. Cycles are safe because each index is memoised before recursion.
 */

const UNDEFINED = -1;
const HOLE = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

export function unflatten(values: unknown[]): unknown {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const cache = new Map<number, unknown>();

  const hydrate = (index: unknown): unknown => {
    if (typeof index !== 'number') return undefined;
    if (index === UNDEFINED || index === HOLE) return undefined;
    if (index === NAN) return NaN;
    if (index === POSITIVE_INFINITY) return Infinity;
    if (index === NEGATIVE_INFINITY) return -Infinity;
    if (index === NEGATIVE_ZERO) return -0;
    if (cache.has(index)) return cache.get(index);
    const value = values[index];
    if (value === null || typeof value !== 'object') {
      cache.set(index, value);
      return value;
    }
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') {
        const tag = value[0];
        if (tag === 'Date') {
          const d = new Date(value[1] as string);
          cache.set(index, d);
          return d;
        }
        if (tag === 'Object') {
          const o = Object(value[1]);
          cache.set(index, o);
          return o;
        }
        if (tag === 'null') {
          const o: Record<string, unknown> = {};
          cache.set(index, o);
          for (let i = 1; i < value.length; i += 2) o[value[i] as string] = hydrate(value[i + 1]);
          return o;
        }
        if (tag === 'Map') {
          const m = new Map<unknown, unknown>();
          cache.set(index, m);
          for (let i = 1; i < value.length; i += 2) m.set(hydrate(value[i]), hydrate(value[i + 1]));
          return m;
        }
        if (tag === 'Set') {
          const s = new Set<unknown>();
          cache.set(index, s);
          for (let i = 1; i < value.length; i++) s.add(hydrate(value[i]));
          return s;
        }
        if (tag === 'RegExp') {
          const r = new RegExp(value[1] as string, value[2] as string | undefined);
          cache.set(index, r);
          return r;
        }
        if (tag === 'BigInt') {
          const b = BigInt(value[1] as string);
          cache.set(index, b);
          return b;
        }
      }
      const out: unknown[] = new Array(value.length);
      cache.set(index, out);
      for (let i = 0; i < value.length; i++) {
        if (value[i] === HOLE) continue;
        out[i] = hydrate(value[i]);
      }
      return out;
    }
    const obj: Record<string, unknown> = {};
    cache.set(index, obj);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      obj[key] = hydrate((value as Record<string, unknown>)[key]);
    }
    return obj;
  };

  return hydrate(0);
}
