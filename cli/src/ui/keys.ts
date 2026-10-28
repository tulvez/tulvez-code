import * as readline from 'readline';

export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

/** Tuşu alan bileşen; true dönerse tuş tüketilmiş sayılır. */
export type KeyHandler = (ch: string | undefined, key: Key) => void;

const stack: KeyHandler[] = [];
let started = false;
let pasting = false;

/**
 * Terminali ham kipe alır; her tuş yalnız en üstteki bileşene gider (giriş kutusu, seçim listesi,
 * yanıt sırasında Esc dinleyicisi). Yapıştırma (bracketed paste) içindeki Enter satır sonu sayılır.
 */
export function startKeys(): void {
  if (started || !process.stdin.isTTY) return;
  started = true;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?2004h');
  process.stdin.on('keypress', (ch: string | undefined, key: Key | undefined) => {
    const k = key ?? { sequence: ch };
    if (k.name === 'paste-start') { pasting = true; return; }
    if (k.name === 'paste-end') { pasting = false; return; }
    const top = stack[stack.length - 1];
    if (!top) return;
    if (pasting && (k.name === 'return' || k.name === 'enter')) {
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
