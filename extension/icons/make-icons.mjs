// Generates the Stayful Intelligence toolbar icons: a cream "S" on a rounded
// green square. The mark is built from signed distance fields and sampled with
// 3x3 supersampling plus analytic edge coverage, so each size is drawn at its
// own resolution rather than scaled down — which is what keeps the 16px icon
// legible in the toolbar. Run `node extension/icons/make-icons.mjs` after
// changing the colours or the mark.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const BG = [0x5d, 0x81, 0x56]; // Stayful green
const FG = [0xf7, 0xf8, 0xf4]; // cream

// --- PNG encoding ---------------------------------------------------------

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

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Geometry -------------------------------------------------------------
// Everything below works in a unit square, x and y in [-1, 1], y pointing up.

const TAU = Math.PI * 2;
const norm = (a) => ((a % TAU) + TAU) % TAU;
const rad = (deg) => (deg * Math.PI) / 180;

// Distance to a circular arc of radius r about (cx, cy), swept anticlockwise
// from a0 to a1, with round caps.
function arcDistance(px, py, cx, cy, r, a0, a1) {
  const dx = px - cx;
  const dy = py - cy;
  if (norm(Math.atan2(dy, dx) - a0) <= norm(a1 - a0)) return Math.abs(Math.hypot(dx, dy) - r);
  return Math.min(
    Math.hypot(px - (cx + r * Math.cos(a0)), py - (cy + r * Math.sin(a0))),
    Math.hypot(px - (cx + r * Math.cos(a1)), py - (cy + r * Math.sin(a1))),
  );
}

// Distance to a square of half-extent `half` with corners rounded by `radius`.
function roundedSquareDistance(px, py, half, radius) {
  const qx = Math.abs(px) - (half - radius);
  const qy = Math.abs(py) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

// The "S": two arcs of equal radius meeting at the origin with a shared
// tangent, so the join is seamless. The upper bowl runs from the top-right
// terminal round to the centre; the lower bowl carries on to the bottom-left.
// The two bowls stack, so the letter stands 4R tall plus the stroke — keep R
// small or the mark outgrows the tile.
const R = 0.3;
const ASPECT = 1.25; // bowls are widened slightly; a circular S reads too narrow
const UPPER = [rad(20), rad(270)];
const LOWER = [rad(200), rad(90)];

function markDistance(px, py) {
  const x = px / ASPECT;
  return Math.min(
    arcDistance(x, py, 0, R, R, UPPER[0], UPPER[1]),
    arcDistance(x, py, 0, -R, R, LOWER[0], LOWER[1]),
  );
}

// --- Rasterising ----------------------------------------------------------

const SAMPLES = 3;

function render(size) {
  // Heavier stroke at small sizes: a hairline S disappears at 16px.
  const stroke = 0.105 + 0.55 / size;
  const half = 1 - 1 / size; // half a pixel of breathing room
  const radius = half * 0.44;
  const perUnit = size / 2; // pixels per unit, for analytic edge coverage
  const rgba = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const ux = ((x + (sx + 0.5) / SAMPLES) / size) * 2 - 1;
          const uy = 1 - ((y + (sy + 0.5) / SAMPLES) / size) * 2;
          bg += Math.min(Math.max(0.5 - roundedSquareDistance(ux, uy, half, radius) * perUnit, 0), 1);
          fg += Math.min(Math.max(0.5 - (markDistance(ux, uy) - stroke) * perUnit, 0), 1);
        }
      }
      bg /= SAMPLES * SAMPLES;
      fg = Math.min(fg / (SAMPLES * SAMPLES), bg); // the mark never spills past the tile
      const alpha = fg + bg * (1 - fg);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        // Premultiplied compose, then unpremultiply back into straight alpha.
        const v = FG[c] * fg + BG[c] * bg * (1 - fg);
        rgba[i + c] = alpha > 0 ? Math.round(Math.min(v / alpha, 255)) : 0;
      }
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

// 16/48/128 ship in the extension; 512 is for the Chrome Web Store listing.
for (const size of [16, 48, 128, 512]) {
  const file = join(here, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote icon${size}.png`);
}
