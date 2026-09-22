/**
 * Draw the application icon, and write it in the two formats Windows and
 * Linux want.
 *
 *     node scripts/desktop/make-icon.mjs        # or: npm run desktop:icon
 *
 * Why a script rather than two committed binaries: an icon checked in as a
 * blob is a file nobody can change. This container has no ImageMagick, no
 * Inkscape and no `sharp`, so the alternative to generating it was pasting in
 * base64 from somewhere else and hoping. Everything below uses only `node:zlib`
 * — a PNG is a handful of chunks around a deflate stream, and an `.ico` is a
 * 6-byte header, one 16-byte directory entry per size, and the images after
 * it. That is a small price for an icon that can be re-tuned by editing three
 * numbers and running one command.
 *
 * The design: a graphite field with an amber timing tower — three bars of
 * decreasing length, the way a leaderboard reads at a glance. The binding
 * constraint is 16x16, which is the size Windows actually shows in the
 * taskbar and the Alt-Tab switcher. Everything here is chosen for that size
 * and then allowed to scale up; a finer mark that only works at 256 would be
 * the wrong trade.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD_DIR = join(ROOT, 'build');

/** Sizes Windows picks between. 16 is the one that matters; 256 is the one Explorer shows. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** electron-builder wants a single large PNG for the Linux targets. */
const PNG_SIZE = 1024;

// ---------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------

/** Field, from the top edge down. The same graphite the application opens on. */
const FIELD_TOP = [0x1b, 0x20, 0x27];
const FIELD_BOTTOM = [0x0a, 0x0d, 0x11];
/** A hairline rim, so the icon does not dissolve into a dark taskbar. */
const RIM = [0x2f, 0x38, 0x43];
/** Leader, second, third. Decreasing width *and* decreasing brightness. */
const BARS = [
  { width: 0.57, colour: [0xf5, 0xa5, 0x24] },
  { width: 0.435, colour: [0xe2, 0x95, 0x1f] },
  { width: 0.3, colour: [0xcf, 0x84, 0x19] },
];

const CORNER = 0.16;
const RIM_WIDTH = 0.018;
const BAR_HEIGHT = 0.152;
const BAR_GAP = 0.062;
const BAR_LEFT = 0.215;

/** Inside a rounded rectangle, in the unit square. */
function inRoundedRect(u, v, x, y, w, h, r) {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  const dx = Math.max(x + radius - u, 0, u - (x + w - radius));
  const dy = Math.max(y + radius - v, 0, v - (y + h - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Colour at one point of the unit square, or null for fully transparent.
 *
 * Sampled many times per pixel (below) rather than anti-aliased analytically:
 * supersampling is a dozen lines instead of a coverage solver, and at these
 * sizes the cost is milliseconds.
 */
function sample(u, v) {
  const barBlockHeight = BARS.length * BAR_HEIGHT + (BARS.length - 1) * BAR_GAP;
  const firstBarTop = (1 - barBlockHeight) / 2;

  for (let index = 0; index < BARS.length; index += 1) {
    const top = firstBarTop + index * (BAR_HEIGHT + BAR_GAP);
    const bar = BARS[index];
    if (inRoundedRect(u, v, BAR_LEFT, top, bar.width, BAR_HEIGHT, BAR_HEIGHT * 0.34)) {
      return bar.colour;
    }
  }

  const inField = inRoundedRect(u, v, 0, 0, 1, 1, CORNER);
  if (!inField) return null;

  const inInner = inRoundedRect(
    u,
    v,
    RIM_WIDTH,
    RIM_WIDTH,
    1 - 2 * RIM_WIDTH,
    1 - 2 * RIM_WIDTH,
    CORNER - RIM_WIDTH,
  );
  if (!inInner) return RIM;

  // A vertical gradient rather than a flat fill: flat graphite at 256px looks
  // like a missing icon, and the gradient costs nothing at 16px.
  return [
    Math.round(FIELD_TOP[0] + (FIELD_BOTTOM[0] - FIELD_TOP[0]) * v),
    Math.round(FIELD_TOP[1] + (FIELD_BOTTOM[1] - FIELD_TOP[1]) * v),
    Math.round(FIELD_TOP[2] + (FIELD_BOTTOM[2] - FIELD_TOP[2]) * v),
  ];
}

/** Render the icon at `size`, returning straight (un-premultiplied) RGBA. */
function render(size) {
  // Small icons get more samples: that is where a ragged edge is visible and
  // where the whole render is cheap anyway.
  const supersample = size <= 64 ? 8 : size <= 256 ? 4 : 2;
  const perPixel = supersample * supersample;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        const v = (y + (sy + 0.5) / supersample) / size;
        for (let sx = 0; sx < supersample; sx += 1) {
          const u = (x + (sx + 0.5) / supersample) / size;
          const colour = sample(u, v);
          if (colour === null) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          covered += 1;
        }
      }
      const offset = (y * size + x) * 4;
      if (covered === 0) continue;
      // Average over the covered samples only, so the corners fade out in
      // alpha instead of darkening towards black.
      rgba[offset] = Math.round(r / covered);
      rgba[offset + 1] = Math.round(g / covered);
      rgba[offset + 2] = Math.round(b / covered);
      rgba[offset + 3] = Math.round((covered / perPixel) * 255);
    }
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Filter type 0 on every scanline. The image is a flat field and three
  // bars; a smarter filter would save a few kilobytes and cost clarity here.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// ICO
// ---------------------------------------------------------------------------

/**
 * One image inside an `.ico`, as a 32-bit bottom-up DIB.
 *
 * Vista and later accept PNG-compressed entries, and every icon editor writes
 * them for 256x256. We write plain DIBs for every size instead: the same file
 * is read by NSIS while it builds the installer, by the Windows shell, and by
 * electron-builder's own icon tooling, and a DIB is the one encoding all three
 * have understood since 1995. The cost is about 350 KB of committed binary,
 * which buys not having to debug an icon on a machine we cannot reach.
 */
function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight — XOR image plus AND mask
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    // DIB rows run bottom to top.
    const source = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      const from = source + x * 4;
      const to = (y * size + x) * 4;
      xor[to] = rgba[from + 2]; // B
      xor[to + 1] = rgba[from + 1]; // G
      xor[to + 2] = rgba[from]; // R
      xor[to + 3] = rgba[from + 3]; // A
    }
  }

  // The 1-bit AND mask predates the alpha channel. Leaving it all zero means
  // "every pixel opaque" and lets the alpha above do the work; Windows only
  // falls back to the mask for 1/4/8-bit icons.
  const maskStride = (((size + 31) >> 5) * 4);
  const mask = Buffer.alloc(maskStride * size);

  header.writeUInt32LE(xor.length + mask.length, 20); // biSizeImage
  return Buffer.concat([header, xor, mask]);
}

function encodeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    // 256 is stored as 0: the field is one byte wide.
    directory[entry] = image.size === 256 ? 0 : image.size;
    directory[entry + 1] = image.size === 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette size — none, this is true colour
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.data)]);
}

// ---------------------------------------------------------------------------

mkdirSync(BUILD_DIR, { recursive: true });

const ico = encodeIco(
  ICO_SIZES.map((size) => ({ size, data: encodeDib(size, render(size)) })),
);
const png = encodePng(PNG_SIZE, render(PNG_SIZE));

const icoFile = join(BUILD_DIR, 'icon.ico');
const pngFile = join(BUILD_DIR, 'icon.png');
writeFileSync(icoFile, ico);
writeFileSync(pngFile, png);

console.log(`\nDrew the application icon\n`);
console.log(`  ${relative(ROOT, icoFile)}  ${ICO_SIZES.join(', ')} px  (${kb(ico)})`);
console.log(`  ${relative(ROOT, pngFile)}  ${PNG_SIZE} px  (${kb(png)})\n`);

function kb(buffer) {
  return `${Math.round(buffer.length / 1024)} KB`;
}
