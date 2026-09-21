/**
 * A minimal QR encoder, so the report's "scan to book" code needs no runtime
 * dependency and the booking URL stays a greppable string rather than being
 * frozen into a committed PNG. That matters because white-label reports carry
 * the customer's own booking link, not Stayful's.
 *
 * Deliberately narrow: byte mode, error-correction level M, versions 1–10.
 * That covers any plausible booking URL (version 10 holds 213 bytes) without
 * carrying the rest of the specification.
 *
 * Implements ISO/IEC 18004. Verified against a reference implementation by the
 * golden fingerprint in qr.test.ts.
 */

/** Data codewords and EC-per-block for level M, indexed by version 1–10. */
interface VersionSpec {
  /** Total data codewords available. */
  data: number;
  /** Error-correction codewords per block. */
  ecPerBlock: number;
  /** [blockCount, dataCodewordsPerBlock] for each of the one or two groups. */
  groups: Array<[number, number]>;
}

const SPECS: Record<number, VersionSpec> = {
  1: { data: 16, ecPerBlock: 10, groups: [[1, 16]] },
  2: { data: 28, ecPerBlock: 16, groups: [[1, 28]] },
  3: { data: 44, ecPerBlock: 26, groups: [[1, 44]] },
  4: { data: 64, ecPerBlock: 18, groups: [[2, 32]] },
  5: { data: 86, ecPerBlock: 24, groups: [[2, 43]] },
  6: { data: 108, ecPerBlock: 16, groups: [[4, 27]] },
  7: { data: 124, ecPerBlock: 18, groups: [[4, 31]] },
  8: { data: 154, ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  9: { data: 182, ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  10: { data: 216, ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
};

/** Centres of the alignment patterns, by version. */
const ALIGNMENT: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// ── GF(256) arithmetic, generator 0x11D ──────────────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

/** The generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let d = 0; d < degree; d += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i += 1) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

function ecCodewords(data: number[], count: number): number[] {
  const gen = generatorPoly(count);
  const rem = new Array<number>(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < count; i += 1) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

// ── Bit stream ───────────────────────────────────────────────────────────
class BitBuffer {
  readonly bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
}

const utf8Bytes = (text: string): number[] =>
  Array.from(new TextEncoder().encode(text));

function pickVersion(byteLength: number): number {
  for (let v = 1; v <= 10; v += 1) {
    // Mode indicator (4) + character count (8 or 16) + payload.
    const countBits = v < 10 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= SPECS[v].data * 8) return v;
  }
  throw new Error(
    `qr: ${byteLength} bytes exceeds the version-10 capacity this encoder supports`,
  );
}

function buildCodewords(text: string, version: number): number[] {
  const spec = SPECS[version];
  const bytes = utf8Bytes(text);
  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) buf.put(b, 8);

  const capacityBits = spec.data * 8;
  // Terminator: up to four zero bits.
  buf.put(0, Math.min(4, capacityBits - buf.bits.length));
  // Pad to a byte boundary.
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | buf.bits[i + j];
    codewords.push(byte);
  }
  // Alternating pad codewords until the version is full.
  const PAD = [0xec, 0x11];
  let p = 0;
  while (codewords.length < spec.data) {
    codewords.push(PAD[p % 2]);
    p += 1;
  }
  return codewords;
}

/** Splits into blocks, appends EC, and interleaves as the spec requires. */
function interleave(codewords: number[], version: number): number[] {
  const spec = SPECS[version];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [count, size] of spec.groups) {
    for (let b = 0; b < count; b += 1) {
      const block = codewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(ecCodewords(block, spec.ecPerBlock));
    }
  }

  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// ── Matrix ───────────────────────────────────────────────────────────────
type Grid = Array<Array<boolean | null>>;

function blankGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.length;

  const finder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const y = row + r;
        const x = col + c;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        grid[y][x] = inside && (onBorder || inCore);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Alignment patterns, skipping the three finder corners.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          grid[r + dy][c + dx] =
            Math.max(Math.abs(dy), Math.abs(dx)) !== 1;
        }
      }
    }
  }

  // The dark module, always set.
  grid[size - 8][8] = true;
}

/** Reserves the format-information cells so data placement skips them. */
function reserveFormat(grid: Grid): void {
  const size = grid.length;
  for (let i = 0; i < 9; i += 1) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = 0; i < 8; i += 1) {
    if (grid[8][size - 1 - i] === null) grid[8][size - 1 - i] = false;
    if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false;
  }
}

function placeData(grid: Grid, bytes: number[]): boolean[][] {
  const size = grid.length;
  const reserved = grid.map((row) => row.map((cell) => cell !== null));
  const bits: number[] = [];
  for (const b of bytes) for (let i = 7; i >= 0; i -= 1) bits.push((b >>> i) & 1);

  let bit = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    // Column 6 is the vertical timing pattern and is not a data column.
    const col = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [col, col - 1]) {
        if (reserved[y][x]) continue;
        grid[y][x] = bit < bits.length ? bits[bit] === 1 : false;
        bit += 1;
      }
    }
    upward = !upward;
  }
  return grid as boolean[][];
}

const MASKS: Array<(i: number, j: number) => boolean> = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** BCH(15,5) format information for level M and the given mask. */
function formatBits(mask: number): number[] {
  const data = (0b00 << 3) | mask; // 00 = level M
  let value = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if ((value >>> (i + 10)) & 1) value ^= 0b10100110111 << i;
  }
  const combined = ((data << 10) | value) ^ 0b101010000010010;
  const out: number[] = [];
  for (let i = 0; i < 15; i += 1) out.push((combined >>> i) & 1);
  return out;
}

/**
 * BCH(18,6) version information. Only versions 7 and above carry it; smaller
 * symbols encode their version in the format information alone.
 */
function versionBits(version: number): number[] {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const combined = (version << 12) | rem;
  const out: number[] = [];
  for (let i = 0; i < 18; i += 1) out.push((combined >>> i) & 1);
  return out;
}

/** Marks the two version-information blocks so data placement skips them. */
function reserveVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  const size = grid.length;
  for (let i = 0; i < 18; i += 1) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid[b][a] = false;
    grid[a][b] = false;
  }
}

/** Version information is never masked, so it is written after masking. */
function applyVersion(grid: boolean[][], version: number): void {
  if (version < 7) return;
  const size = grid.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid[b][a] = bits[i] === 1;
    grid[a][b] = bits[i] === 1;
  }
}

function applyFormat(grid: boolean[][], mask: number): void {
  const size = grid.length;
  const bits = formatBits(mask); // index 0 is the least significant bit

  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i += 1) grid[i][8] = bits[i] === 1;
  grid[7][8] = bits[6] === 1;
  grid[8][8] = bits[7] === 1;
  grid[8][7] = bits[8] === 1;
  for (let i = 9; i < 15; i += 1) grid[8][14 - i] = bits[i] === 1;

  // Second copy, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i += 1) grid[8][size - 1 - i] = bits[i] === 1;
  for (let i = 8; i < 15; i += 1) grid[size - 15 + i][8] = bits[i] === 1;

  grid[size - 8][8] = true; // the dark module
}

function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0;

  const runScore = (line: boolean[]) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  const FINDER_A = [true, false, true, true, true, false, true, false, false, false, false];
  const FINDER_B = [false, false, false, false, true, false, true, true, true, false, true];
  const hasPattern = (line: boolean[], at: number, pat: boolean[]) =>
    pat.every((v, k) => line[at + k] === v);

  for (let i = 0; i < size; i += 1) {
    const row = grid[i];
    const col = grid.map((r) => r[i]);
    score += runScore(row) + runScore(col);
    for (let j = 0; j + 11 <= size; j += 1) {
      if (hasPattern(row, j, FINDER_A) || hasPattern(row, j, FINDER_B)) score += 40;
      if (hasPattern(col, j, FINDER_A) || hasPattern(col, j, FINDER_B)) score += 40;
    }
  }

  let dark = 0;
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (grid[i][j]) dark += 1;
      if (i + 1 < size && j + 1 < size) {
        const a = grid[i][j];
        if (a === grid[i][j + 1] && a === grid[i + 1][j] && a === grid[i + 1][j + 1]) {
          score += 3;
        }
      }
    }
  }
  // Rule 4: how far the dark:light ratio strays from 50%, in 5% steps.
  //
  // ISO/IEC 18004 counts whole steps, so a symbol that is 52% dark deviates by
  // less than one step and scores nothing. The widely-used `qrcode` npm package
  // rounds that up to a full step and penalises it; this follows the standard
  // instead. The practical effect is that we occasionally settle on a different
  // (equally valid) mask from that library — the symbol itself is identical.
  const pct = (dark * 100) / (size * size);
  score += 10 * Math.floor(Math.abs(pct - 50) / 5);
  return score;
}

export interface QrMatrix {
  size: number;
  rows: boolean[][];
}

/**
 * Encodes `text` as a QR matrix. Throws only when the payload is longer than a
 * version-10 symbol holds — callers render the CTA without a code rather than
 * letting that reach a customer's report.
 */
export function encodeQr(text: string, forceMask?: number): QrMatrix {
  const version = pickVersion(utf8Bytes(text).length);
  const size = 17 + version * 4;
  const codewords = interleave(buildCodewords(text, version), version);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  const masks = forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of masks) {
    const grid = blankGrid(size);
    placeFunctionPatterns(grid, version);
    reserveFormat(grid);
    reserveVersion(grid, version);
    const reserved = grid.map((row) => row.map((cell) => cell !== null));
    const filled = placeData(grid, codewords);
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        if (!reserved[i][j] && MASKS[mask](i, j)) filled[i][j] = !filled[i][j];
      }
    }
    applyFormat(filled, mask);
    applyVersion(filled, version);
    const score = penalty(filled);
    if (score < bestScore) {
      bestScore = score;
      best = filled;
    }
  }

  return { size, rows: best as boolean[][] };
}
