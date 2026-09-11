// Builds the browser extension into extension/dist with esbuild.
//   node extension/build.mjs            production manifest (intelligence.stayful.co.uk)
//   node extension/build.mjs --dev      also allows http://localhost:3000 for local testing
//   node extension/build.mjs --watch    rebuild on change
// The bundles import the listing library from src/lib/listing, so the
// extension and the website always share one URL detector and one set of
// types.
import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
if (dev) {
  manifest.name += ' (dev)';
  manifest.host_permissions.push('http://localhost:3000/*');
  manifest.externally_connectable.matches.push('http://localhost:3000/*');
  // A stable id for the dev build: the id is derived from the public key, so
  // a key kept in extension/dev-key.pem (git-ignored) gives the same id on
  // every load. Set NEXT_PUBLIC_EXTENSION_ID to the printed value locally.
  const keyPath = join(here, 'dev-key.pem');
  let privateKey;
  if (existsSync(keyPath)) privateKey = createPrivateKey(readFileSync(keyPath));
  else {
    privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  }
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  manifest.key = spki.toString('base64');
  const id = [...createHash('sha256').update(spki).digest().subarray(0, 16)].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
  console.log(`dev extension id: ${id}`);
  writeFileSync(join(dist, 'EXTENSION_ID'), id);
}
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
cpSync(join(here, 'src', 'popup.html'), join(dist, 'popup.html'));
mkdirSync(join(dist, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) cpSync(join(here, 'icons', `icon${size}.png`), join(dist, 'icons', `icon${size}.png`));

const options = {
  entryPoints: {
    background: join(here, 'src', 'background.ts'),
    content: join(here, 'src', 'content.ts'),
    popup: join(here, 'src', 'popup.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  platform: 'browser',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await build(options);
  console.log(`built ${dev ? 'dev' : 'production'} extension into ${dist}`);
}
