// Generates the placeholder toolbar icons (Stayful green square with a
// lighter "S" block). Run `node extension/icons/make-icons.mjs` after
// changing colours; real artwork can replace the PNGs at any time.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
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
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size) {
  const bg = [0x5d, 0x81, 0x56];
  const fg = [0xf7, 0xf8, 0xf4];
  const rows = [];
  const s = size;
  const inS = (x, y) => {
    // A chunky "S": three horizontal bars joined by two verticals, in a 6x8 grid.
    const gx = Math.floor((x / s) * 6), gy = Math.floor((y / s) * 8);
    if (gx === 0 || gx === 5 || gy === 0 || gy === 7) return false;
    if (gy === 1 || gy === 3 || gy === 4 || gy === 6) return gx >= 1 && gx <= 4;
    if (gy === 2) return gx === 1;
    if (gy === 5) return gx === 4;
    return false;
  };
  for (let y = 0; y < s; y++) {
    const row = [0];
    for (let x = 0; x < s; x++) {
      const c = inS(x, y) ? fg : bg;
      row.push(c[0], c[1], c[2], 255);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [16, 48, 128]) writeFileSync(join(here, `icon${size}.png`), png(size));
console.log('icons written');
