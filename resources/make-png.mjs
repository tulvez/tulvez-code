// resources/make-png.mjs
// Tulvez Code ikon PNG'si (128x128) — harici bagimlilik olmadan uretir.
import zlib from 'zlib';
import { writeFileSync } from 'fs';

const W = 128, H = 128;
const bg = [24, 24, 24];
const green = [63, 185, 80];

function color(x, y) {
  const topW = 68, topH = 18;
  const stemW = 20, stemH = 62;
  if (x >= W / 2 - topW / 2 && x < W / 2 + topW / 2 && y >= 30 && y < 30 + topH) return green;
  if (x >= W / 2 - stemW / 2 && x < W / 2 + stemW / 2 && y >= 30 + topH && y < 30 + topH + stemH) return green;
  return bg;
}

const raw = Buffer.alloc((W * 4 + 1) * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = color(x, y);
    raw[p++] = r;
    raw[p++] = g;
    raw[p++] = b;
    raw[p++] = 255;
  }
}

const idat = zlib.deflateSync(raw, { level: 9 });

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync('resources/icon.png', png);
console.log('icon.png yazildi', png.length, 'bayt');