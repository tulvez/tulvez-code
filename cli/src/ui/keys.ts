import * as readline from 'readline';

export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
  code?: string;
}

/** Tuşu alan bileşen (giriş kutusu, seçim listesi, yanıt sırasında Esc dinleyicisi). */
export type KeyHandler = (ch: string | undefined, key: Key) => void;

const stack: KeyHandler[] = [];
let started = false;
let pasting = false;
// Fare dizisi (SGR: ESC [ < b ; x ; y M) Node'da harf harf gelir; burada birleştirilir
let mouseBuf: string | null = null;
let scrollHandler: ((delta: number) => void) | null = null;
let pasteHandler: (() => void) | null = null;
// Tek parça gelen çok karakterli girdi (terminalin yapıştırması; işaretsiz gelirse) içindeki Enter satır sonudur
let burst = false;

/** Tekerlek ve PgUp/PgDn sohbeti kaydırır; hangi bileşen odakta olursa olsun. */
export function onScroll(handler: (delta: number) => void): void {
  scrollHandler = handler;
}

/** Sağ tık (fare izlemesi açıkken terminal yapıştırmaz, olay uygulamaya gelir) → panodan yapıştır. */
export function onPasteRequest(handler: (() => void) | null): void {
  pasteHandler = handler;
}

function mouse(seq: string): void {
  const m = /^(\d+);\d+;\d+([Mm])$/.exec(seq);
  if (!m) return;
  const b = Number(m[1]);
  if (b === 64) scrollHandler?.(3);
  else if (b === 65) scrollHandler?.(-3);
  else if (b === 2 && m[2] === 'M') pasteHandler?.();
}

/**
 * Terminali ham kipe alır; her tuş yalnız en üstteki bileşene gider. Yapıştırma (bracketed paste)
 * içindeki Enter satır sonu sayılır.
 */
export function startKeys(): void {
  if (started || !process.stdin.isTTY) return;
  started = true;
  // Tuş olaylarından önce çalışır: aynı parçadaki tuşlar işlenirken bayrak geçerli, sonra kalkar
  process.stdin.prependListener('data', (chunk: Buffer | string) => {
    const s = chunk.toString();
    burst = s.length > 2 && /[\r\n]/.test(s) && /[^\r\n\x1b]/.test(s) && !s.startsWith('\x1b');
    if (burst) setImmediate(() => { burst = false; });
  });
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?2004h');
  process.stdin.on('keypress', (ch: string | undefined, key: Key | undefined) => {
    const k = key ?? { sequence: ch };
    if (mouseBuf !== null) {
      mouseBuf += ch ?? k.sequence ?? '';
      if (/[Mm]$/.test(mouseBuf) || mouseBuf.length > 20) {
        mouse(mouseBuf);
        mouseBuf = null;
      }
      return;
    }
    if (k.code === '[<') { mouseBuf = ''; return; }
    if (k.name === 'paste-start') { pasting = true; return; }
    if (k.name === 'paste-end') { pasting = false; return; }
    if (k.name === 'pageup' || k.name === 'pagedown') {
      const rows = Math.max(3, (process.stdout.rows || 24) - 8);
      scrollHandler?.(k.name === 'pageup' ? rows : -rows);
      return;
    }
    const top = stack[stack.length - 1];
    if (!top) return;
    if ((pasting || burst) && (k.name === 'return' || k.name === 'enter')) {
      top('\n', { name: 'paste-newline', sequence: '\n' });
      return;
    }
    top(ch, k);
  });
  process.stdin.resume();
}

export function stopKeys(): void {
  if (!started) return;
  started = false;
  process.stdout.write('\x1b[?2004l');
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

export function pushKeys(handler: KeyHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

export const isCtrlC = (k: Key): boolean => !!k.ctrl && k.name === 'c';
