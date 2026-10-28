import { decodeKittyPrintable, parseKey } from '@earendil-works/pi-tui';

export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
  code?: string;
}

/** Tuşu alan bileşen (giriş kutusu, seçim listesi). */
export type KeyHandler = (ch: string | undefined, key: Key) => void;

const stack: KeyHandler[] = [];

// pi-tui'nin tuş adları → bileşenlerin beklediği (readline biçimindeki) adlar
const NAMES: Record<string, string> = {
  enter: 'return', return: 'return', esc: 'escape', pageUp: 'pageup', pageDown: 'pagedown', space: 'space',
};

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * Terminalden gelen ham girdiyi tuşlara çevirir. Ekranı pi-tui çizer ve girdiyi o okur (Kitty klavye
 * protokolü, Windows'ta VT girdisi, fare); burada yalnız klavye ve yapıştırma tuşları kalır.
 * Yapıştırma tek parça gelir: { name: 'paste', sequence: metin }.
 */
export function toKeys(data: string): Array<[string | undefined, Key]> {
  if (data.startsWith(PASTE_START)) {
    const end = data.indexOf(PASTE_END);
    const text = data.slice(PASTE_START.length, end < 0 ? undefined : end);
    return [[undefined, { name: 'paste', sequence: text }]];
  }
  const id = parseKey(data);
  if (id) {
    const parts = id.split('+');
    const base = parts[parts.length - 1];
    const mods = new Set(parts.slice(0, -1));
    const ctrl = mods.has('ctrl');
    const meta = mods.has('alt') || mods.has('super');
    const single = [...base].length === 1;
    const upper = single && base !== base.toLowerCase();
    const key: Key = {
      name: NAMES[base] ?? (single ? base.toLowerCase() : base),
      ctrl,
      meta,
      shift: mods.has('shift') || upper,
      sequence: data,
    };
    // Yazılabilir karakter: değiştiricisiz ya da yalnız Shift'li tek karakter (boşluk dahil)
    const printable = !ctrl && !meta ? (base === 'space' ? ' ' : single ? (data.length === 1 ? data : base) : undefined) : undefined;
    return [[printable, key]];
  }
  const decoded = decodeKittyPrintable(data);
  if (decoded) return [...decoded].map((ch) => [ch, { name: ch.toLowerCase(), sequence: ch }]);
  // Birden çok yazılabilir karakter (hızlı yazım, IME, Türkçe harfler): tek tek
  // eslint-disable-next-line no-control-regex
  if (!/[\x00-\x1f\x7f]/.test(data)) return [...data].map((ch) => [ch, { name: ch.toLowerCase(), sequence: ch }]);
  return [];
}

/** Ham girdiyi en üstteki bileşene iletir. */
export function dispatchInput(data: string): void {
  for (const [ch, key] of toKeys(data)) {
    const top = stack[stack.length - 1];
    if (top) top(ch, key);
  }
}

/** Yapıştırmayı (sağ tık, pano) en üstteki bileşene iletir. */
export function dispatchPaste(text: string): void {
  stack[stack.length - 1]?.(undefined, { name: 'paste', sequence: text });
}

export function pushKeys(handler: KeyHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

export const isCtrlC = (k: Key): boolean => !!k.ctrl && k.name === 'c';
