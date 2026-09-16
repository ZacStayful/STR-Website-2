// Builds the extension and zips it for a Chrome Web Store upload.
//   node extension/package.mjs   → extension/stayful-intelligence-<version>.zip
// The Web Store wants a zip of the built directory, so this runs the ordinary
// production build first and then packs extension/dist. It refuses to pack a
// dev build: a manifest carrying `key` or a localhost host permission is
// rejected on upload, and `key` would fight the id the store assigns.
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

execFileSync(process.execPath, [join(here, 'build.mjs')], { stdio: 'inherit' });

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const localhost = [...(manifest.host_permissions ?? []), ...(manifest.externally_connectable?.matches ?? [])]
  .filter((m) => m.includes('localhost'));
if (manifest.key) throw new Error('dist/manifest.json has a `key`: that is the dev build, rebuild without --dev');
if (localhost.length) throw new Error(`dist/manifest.json still allows ${localhost.join(', ')}: rebuild without --dev`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// MS-DOS date and time, which is what the zip format stores.
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

const local = [];
const central = [];
let offset = 0;

for (const file of walk(dist).sort()) {
  const name = relative(dist, file).split(sep).join('/');
  const body = readFileSync(file);
  const deflated = deflateRawSync(body, { level: 9 });
  // Store rather than deflate when compression does not help.
  const stored = deflated.length >= body.length;
  const data = stored ? body : deflated;
  const method = stored ? 0 : 8;
  const crc = crc32(body);
  const nameBuf = Buffer.from(name, 'utf8');

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(body.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  local.push(header, nameBuf, data);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by
  entry.writeUInt16LE(20, 6); // version needed
  entry.writeUInt16LE(method, 10);
  entry.writeUInt16LE(dosTime, 12);
  entry.writeUInt16LE(dosDate, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(data.length, 20);
  entry.writeUInt32LE(body.length, 24);
  entry.writeUInt16LE(nameBuf.length, 28);
  entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: a regular file
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBuf);

  offset += header.length + nameBuf.length + data.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8); // entries on this disk
end.writeUInt16LE(central.length / 2, 10); // entries in total
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const out = join(here, `stayful-intelligence-${manifest.version}.zip`);
writeFileSync(out, Buffer.concat([...local, centralBuf, end]));
console.log(`packaged ${central.length / 2} files into ${out}`);
