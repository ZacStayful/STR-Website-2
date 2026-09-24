#!/usr/bin/env node
/**
 * Downloads the site's web fonts into src/lib/webfonts/ so the build never
 * fetches them.
 *
 * `next/font/google` downloads from Google at build time, and Google
 * intermittently answers with an extensionless `/l/font?kit=…` URL instead of
 * a `.woff2` one — roughly one response in sixty. Next mishandles that in both
 * bundlers (vercel/next.js#99114): webpack crashes pulling an extension off a
 * URL that has none, Turbopack breaks parsing the `&` in its query string. At
 * around twenty faces per build that reddened about one build in four, always
 * on a different family, and never reproducibly.
 *
 * Self-hosting removes the fetch, so the failure cannot happen. Run this again
 * to refresh or add a family, then commit what lands in src/lib/webfonts/.
 *
 *   npm run fonts:fetch
 *
 * Only the `latin` subset is taken, matching the `subsets: ["latin"]` the
 * previous next/font/google calls asked for. Google serves variable fonts
 * where a family has one, so most families are a single file spanning their
 * whole weight range.
 */
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'webfonts');
// Google serves woff2 only to a browser-like UA; Next's own loader does the same.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** family → the axis spec, and whether italic is needed. Weights match what the site used. */
const FAMILIES = [
  { name: 'Inter', file: 'Inter', wght: '400..600', italic: false },
  { name: 'Cormorant Garamond', file: 'CormorantGaramond', wght: '400..600', italic: true },
  { name: 'JetBrains Mono', file: 'JetBrainsMono', wght: '400..500', italic: false },
  { name: 'Caveat', file: 'Caveat', wght: '500..700', italic: false },
  { name: 'Playfair Display', file: 'PlayfairDisplay', wght: '400..700', italic: false },
  { name: 'DM Sans', file: 'DMSans', wght: '400..700', italic: false },
];

function cssUrl(family) {
  const axis = family.italic
    ? `ital,wght@0,${family.wght};1,${family.wght}`
    : `wght@${family.wght}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.name).replace(/%20/g, '+')}:${axis}&display=swap`;
}

/**
 * The latin @font-face blocks only. Google splits a family across many
 * unicode-range subsets; the site asked for `latin`, so the rest is weight we
 * would ship and never use.
 */
function latinFaces(css) {
  const out = [];
  // Each block is preceded by a /* subset */ comment naming it.
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    if (m[1] !== 'latin') continue;
    const body = m[2];
    const url = body.match(/src:\s*url\(([^)]+)\)/)?.[1];
    const style = body.match(/font-style:\s*([^;]+);/)?.[1]?.trim() ?? 'normal';
    const weight = body.match(/font-weight:\s*([^;]+);/)?.[1]?.trim() ?? '400';
    if (url) out.push({ url, style, weight });
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const family of FAMILIES) {
  const res = await fetch(cssUrl(family), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${family.name}: CSS request failed — HTTP ${res.status}`);
  const faces = latinFaces(await res.text());
  if (faces.length === 0) throw new Error(`${family.name}: no latin faces found`);

  for (const face of faces) {
    // The whole point of this script: if Google hands back the extensionless
    // URL that breaks the build, say so rather than writing a file named for a
    // guess.
    if (!/\.woff2$/.test(face.url)) {
      throw new Error(`${family.name}: expected a .woff2 URL, got ${face.url} — rerun; this is the flaky response`);
    }
    const suffix = face.style === 'italic' ? '-Italic' : '';
    const name = `${family.file}${suffix}.woff2`;
    const bin = await fetch(face.url, { headers: { 'User-Agent': UA } });
    if (!bin.ok) throw new Error(`${name}: download failed — HTTP ${bin.status}`);
    const buf = Buffer.from(await bin.arrayBuffer());
    writeFileSync(join(OUT, name), buf);
    manifest.push({ name, weight: face.weight, style: face.style, kb: Math.round(buf.length / 1024) });
    console.log(`${name.padEnd(30)} ${String(face.weight).padEnd(10)} ${face.style.padEnd(8)} ${Math.round(buf.length / 1024)} KB`);
  }
}

const total = readdirSync(OUT).filter((f) => f.endsWith('.woff2')).length;
console.log(`\n${total} files in src/lib/webfonts/`);
console.log('weights, for src/lib/fonts.ts:');
for (const m of manifest) console.log(`  ${m.name}: weight "${m.weight}", style ${m.style}`);
