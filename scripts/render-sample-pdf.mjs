// Renders the property report from fixture data so it can actually be looked at.
//
//   node scripts/render-sample-pdf.mjs            every variant
//   node scripts/render-sample-pdf.mjs full       just one
//
// Bundles the report with esbuild (the same approach as extension/build.mjs)
// rather than booting Next, which is both faster and lets this run in CI. The
// sheet-count assertion is the point: the pages are rendered with wrap={false}
// so a section can never silently split, and this is what proves it.
import { build } from 'esbuild';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, '.tmp', 'report-samples');
const bundle = join(outDir, 'entry.mjs');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, 'scripts/render-entry.tsx')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  // Keep every dependency external: react-pdf resolves fontkit and pdfkit at
  // runtime and does not survive being bundled.
  packages: 'external',
  logLevel: 'warning',
});

const { renderVariants } = await import(bundle);
const only = process.argv[2];
const results = await renderVariants(outDir, only);

let failed = 0;
for (const r of results) {
  if (r.error) {
    console.log(`  FAIL  ${r.name.padEnd(22)} ${r.error}`);
    failed++;
    continue;
  }
  const buf = await readFile(r.file);
  // Count physical sheets in the PDF itself.
  const sheets = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const ok = r.expectedSheets === null || sheets === r.expectedSheets;
  if (!ok) failed++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(22)} ${String(sheets).padStart(2)} sheets` +
    `${r.expectedSheets !== null ? ` (expected ${r.expectedSheets})` : ''}` +
    `  ${(statSync(r.file).size / 1024).toFixed(0)}KB  ${r.file.replace(root + '/', '')}`,
  );
}
console.log(failed ? `\n${failed} variant(s) wrong.` : '\nAll variants rendered with the expected sheet count.');
process.exit(failed ? 1 : 0);
