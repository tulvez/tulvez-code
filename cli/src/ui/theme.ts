/**
 * Renkler ve ölçüler. Terminalin renk derinliğine göre 24 bit, 256 renk ya da 16 renge iner;
 * NO_COLOR ve renk desteklemeyen terminalde düz metin döner.
 */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDepth(): number {
  if (process.env.NO_COLOR || process.env.TERM === 'dumb' || !process.stdout.isTTY) return 1;
  if (process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit' || process.env.WT_SESSION) return 24;
  return process.stdout.getColorDepth?.() ?? 4;
}

const DEPTH = colorDepth();
export const colorEnabled = DEPTH > 1;

function to256([r, g, b]: Rgb): number {
  // Griye yakın tonlar (koyu zeminler) gri rampaya: renk küpünün en koyu grisi #5f5f5f, çok açık kalıyor
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) {
    const v = Math.round((r + g + b) / 3);
    if (v < 8) return 16;
    if (v > 248) return 231;
    return Math.round(((v - 8) / 247) * 24) + 232;
  }
  const c = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * c(r) + 6 * c(g) + c(b);
}

function to16([r, g, b]: Rgb): number {
  const bright = Math.max(r, g, b) > 170 ? 60 : 0;
  const bit = (v: number): number => (v > 100 ? 1 : 0);
  return 30 + bright + (bit(b) << 2 | bit(g) << 1 | bit(r));
}

function fgCode(rgb: Rgb): string {
  if (DEPTH >= 24) return `38;2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  if (DEPTH >= 8) return `38;5;${to256(rgb)}`;
  return String(to16(rgb));
}

export type Paint = (text: string) => string;

export function fg(hex: string): Paint {
  const code = fgCode(hexToRgb(hex));
  return (text) => (colorEnabled ? `\x1b[${code}m${text}\x1b[39m` : text);
}

/** Arka plan rengi (fark satırları) */
export function bg(hex: string): Paint {
  const f = fgCode(hexToRgb(hex));
  // 24 bit / 256 renk: 38;… → 48;… · 16 renk: ön plan 30–37/90–97 → arka plan 40–47/100–107
  const code = f.startsWith('38;') ? `48;${f.slice(3)}` : String(Number(f) + 10);
  return (text) => (colorEnabled ? `\x1b[${code}m${text}\x1b[49m` : text);
}

const sgr = (on: number, off: number): Paint => (text) => (colorEnabled ? `\x1b[${on}m${text}\x1b[${off}m` : text);
export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const italic = sgr(3, 23);
export const inverse = sgr(7, 27);

/** Metni soldan sağa renk geçişiyle boyar (logo ve başlıklar). */
export function gradient(text: string, stops: string[], offset = 0, span?: number): string {
  if (!colorEnabled) return text;
  const chars = [...text];
  const total = span ?? Math.max(1, chars.length - 1);
  const rgbs = stops.map(hexToRgb);
  return chars.map((ch, i) => {
    if (ch === ' ') return ch;
    const t = Math.min(1, (i + offset) / total) * (rgbs.length - 1);
    const k = Math.min(rgbs.length - 2, Math.floor(t));
    const f = t - k;
    const mix: Rgb = [0, 1, 2].map((j) => Math.round(rgbs[k][j] + (rgbs[k + 1][j] - rgbs[k][j]) * f)) as Rgb;
    return `\x1b[${fgCode(mix)}m${ch}`;
  }).join('') + '\x1b[39m';
}

/** Marka renkleri: turuncu → pembe → mor → mavi (Tulvez yörüngesi). */
export const BRAND = ['#FF8A3D', '#F2547D', '#B05CE0', '#539BF5'];

export const c = {
  brand: fg('#FF8A3D'),
  pink: fg('#F2547D'),
  violet: fg('#B05CE0'),
  blue: fg('#539BF5'),
  cyan: fg('#39C5CF'),
  green: fg('#3FB950'),
  yellow: fg('#E3B341'),
  red: fg('#F85149'),
  code: fg('#FFA657'),
  muted: fg('#8B949E'),
  text: fg('#E6EDF3'),
};

/** Eklentideki mod renkleri (Ask kırmızı, Plan mavi, Build yeşil). */
export const MODE_COLOR = { ask: '#E5534B', plan: '#539BF5', build: '#3FB950' } as const;
export const MODE_LABEL = { ask: 'Ask', plan: 'Plan', build: 'Build' } as const;
export const MODE_HINT = {
  ask: 'okur ve açıklar, değişiklik yapmaz',
  plan: 'adım adım plan çıkarır',
  build: 'düzenler ve komut çalıştırır',
} as const;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** Doğu Asya geniş karakterleri ve emoji 2 sütun sayılır. */
function charWidth(cp: number): number {
  if (cp === 0 || cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0; // birleşen işaretler
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

/** Ekranda kaplanan sütun sayısı (ANSI kodları sayılmaz). */
export function width(text: string): number {
  let w = 0;
  for (const ch of stripAnsi(text)) w += charWidth(ch.codePointAt(0) ?? 0);
  return w;
}

export function columns(): number {
  return Math.max(40, process.stdout.columns || 80);
}

/** Metni verilen genişliğe kadar boşlukla doldurur; uzunsa … ile keser (ANSI'siz metin için). */
export function fit(text: string, w: number): string {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (used + cw > w) {
      return `${out.slice(0, Math.max(0, out.length - 1))}…${' '.repeat(Math.max(0, w - used))}`;
    }
    out += ch;
    used += cw;
  }
  return out + ' '.repeat(w - used);
}

/** Uzun metni baştan kısaltır: "…/scratchpad/demo" (yollarda sonu önemli). */
export function fitStart(text: string, w: number): string {
  if (width(text) <= w) return text;
  const chars = [...text];
  let out = '';
  let used = 1;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charWidth(chars[i].codePointAt(0) ?? 0);
    if (used + cw > w) break;
    out = chars[i] + out;
    used += cw;
  }
  return `…${out}`;
}

/** Düz metni sütun genişliğine göre satırlara böler (kelime kırmaz, karakterden böler). */
export function wrapPlain(text: string, w: number): string[] {
  const rows: string[] = [];
  let row = '';
  let used = 0;
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (used + cw > w) {
      rows.push(row);
      row = '';
      used = 0;
    }
    row += ch;
    used += cw;
  }
  rows.push(row);
  return rows;
}

export function charCols(ch: string): number {
  return charWidth(ch.codePointAt(0) ?? 0);
}

/** Renkli metni görünen genişliğe göre keser (renk kodları korunur, sonda sıfırlanır). */
export function truncateAnsi(text: string, w: number): string {
  if (width(text) <= w) return text;
  let out = '';
  let used = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\x1b') {
      const m = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(text.slice(i));
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (used + cw > w - 1) break;
    out += ch;
    used += cw;
    i += ch.length;
  }
  return `${out}…${colorEnabled ? '\x1b[0m' : ''}`;
}

/**
 * Renkli metni görünen genişliğe göre satırlara böler. Renk kodları bölünmez; her yeni satır
 * önceki satırda açık kalan renklerle başlar. Devam satırları `indent` kadar içeriden başlar.
 */
export function wrapAnsi(text: string, w: number, indent = 0): string[] {
  if (width(text) <= w) return [text];
  const rows: string[] = [];
  let active = '';
  let row = '';
  let used = 0;
  let i = 0;
  const pad = ' '.repeat(Math.min(indent, Math.max(0, w - 10)));
  while (i < text.length) {
    if (text[i] === '\x1b') {
      const m = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(text.slice(i));
      if (m) {
        row += m[0];
        active = m[0] === '\x1b[0m' ? '' : active + m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (used + cw > w) {
      rows.push(colorEnabled ? `${row}\x1b[0m` : row);
      row = `${active}${pad}`;
      used = pad.length;
      if (ch === ' ') { i += 1; continue; }
    }
    row += ch;
    used += cw;
    i += ch.length;
  }
  rows.push(row);
  return rows;
}

/** Kenarlıklı kutu (yuvarlak köşe). İçerik satırları ANSI içerebilir; sığmayan satır kesilir. */
export function box(lines: string[], opts: { width?: number; color?: Paint; title?: string } = {}): string[] {
  const paint = opts.color ?? c.muted;
  const inner = Math.max(10, (opts.width ?? Math.min(columns(), 100)) - 4);
  const title = opts.title ? ` ${opts.title} ` : '';
  const top = paint(`╭─${title}${'─'.repeat(Math.max(0, inner + 1 - width(title)))}╮`);
  const body = lines.map((raw) => {
    const l = truncateAnsi(raw, inner);
    const pad = Math.max(0, inner - width(l));
    return `${paint('│')} ${l}${' '.repeat(pad)} ${paint('│')}`;
  });
  const bottom = paint(`╰${'─'.repeat(inner + 2)}╯`);
  return [top, ...body, bottom];
}
