import {
  CURSOR_MARKER, ProcessTerminal, ScrollView, TuiAltScreen, VStack, sliceByColumn, truncateToWidth, visibleWidth,
  type Component, type Focusable,
} from '@earendil-works/pi-tui';
import { readClipboard, writeClipboard } from './clipboard';
import { dispatchInput, dispatchPaste } from './keys';
import { BRAND, bg, c, columns, dim, gradient, width as textWidth, wrapAnsi } from './theme';

/**
 * Tam ekran düzeni (Claude Code'un tam ekran modu gibi), çizimi pi-tui yapar: terminalin alternatif
 * ekranı, yalnız değişen satırlar, senkron çıktı (titreme yok).
 *
 *   ┌ sohbet — kendi kaydırması: fare tekerleği, PgUp/PgDn, Ctrl+Home/End; fareyle sürükleyince seçer
 *   │          ve panoya kopyalar, sağ tık yapıştırır
 *   │ panel (kurulum adımları, düşünme göstergesi, sıra, seçim listesi, öneriler, uyarı)
 *   │ giriş kutusu                                  ← kaydırmaya katılmaz, hep altta
 *   └ durum satırı
 *
 * Bileşenler (giriş kutusu, seçimler, yanıt arayüzü) yalnız bu dosyanın arayüzünü kullanır; pi-tui
 * ayrıntısı burada kalır. Sohbet boşken görünümün ortasında karşılama ekranı durur. Çıkışta sohbet
 * terminalin kendi geçmişine yazılır.
 */

type Slot = 'setup' | 'stream' | 'spinner' | 'queue' | 'select' | 'suggest' | 'notice';
const SLOT_ORDER: Slot[] = ['setup', 'stream', 'spinner', 'queue', 'select', 'suggest', 'notice'];

interface Cursor { row: number; col: number }

/** Genişliğe göre kendini çizen sohbet bloğu (ör. arka planlı kullanıcı mesajı; boyut değişince yeniden çizilir) */
type Block = (width: number) => string[];
type Entry = string | Block;

/** Bellekte tutulan en çok sohbet satırı (eskiler atılır) */
const MAX_LINES = 20_000;

/** Sohbet: satırlar genişliğe göre bölünür, aynı genişlikte önbellekten gelir. */
class Transcript implements Component {
  entries: Entry[] = [];
  private rows: string[] = [];
  private width = 0;
  /** Boşken karşılama ekranı (yükseklik: görünüm alanı) */
  emptyView: (w: number, h: number) => string[] = () => [];
  viewHeight: () => number = () => 0;
  closing = false;

  private layout(entry: Entry, width: number): string[] {
    return typeof entry === 'string' ? wrapAnsi(entry, width, 2) : entry(width);
  }

  append(entry: Entry): void {
    this.entries.push(entry);
    if (this.width) this.rows.push(...this.layout(entry, this.width));
    if (this.entries.length > MAX_LINES) {
      this.entries.splice(0, this.entries.length - MAX_LINES);
      this.width = 0;
    }
  }

  clear(): void {
    this.entries = [];
    this.rows = [];
  }

  render(width: number): string[] {
    if (!this.entries.length) {
      if (this.closing) return [];
      const h = this.viewHeight();
      const view = this.emptyView(width + 1, h).map((l) => truncateToWidth(l, width));
      const padTop = Math.max(0, Math.floor((h - view.length) / 2));
      return [...Array(padTop).fill(''), ...view].slice(0, Math.max(1, h));
    }
    if (width !== this.width) {
      this.width = width;
      this.rows = this.entries.flatMap((e) => this.layout(e, width));
    }
    return this.rows.map((r) => truncateToWidth(r, width));
  }

  invalidate(): void {
    this.width = 0;
  }
}

/** Altta sabit bölge: panel + giriş kutusu + durum satırı. Klavye girdisini bileşenlere iletir. */
class Bottom implements Component, Focusable {
  focused = false;
  slots = new Map<Slot, string[]>();
  input: { lines: string[]; cursor: Cursor | null } | null = null;
  footer: () => string = () => '';
  closing = false;
  height = 0;

  render(width: number): string[] {
    if (this.closing) return [];
    const out: string[] = [];
    for (const s of SLOT_ORDER) out.push(...(this.slots.get(s) ?? []));
    const inputStart = out.length;
    if (this.input) out.push(...this.input.lines);
    out.push(this.footer());
    const lines = out.map((l) => truncateToWidth(l, width));
    const cur = this.input?.cursor;
    if (cur && this.focused) {
      // Gerçek imleç (IME ve ekran okuyucular için) giriş satırındaki yerinde
      const i = inputStart + cur.row;
      const line = lines[i] ?? '';
      const w = visibleWidth(line);
      lines[i] = `${sliceByColumn(line, 0, cur.col)}${CURSOR_MARKER}${sliceByColumn(line, cur.col, Math.max(0, w - cur.col))}`;
    }
    this.height = lines.length;
    return lines;
  }

  handleInput(data: string): void {
    dispatchInput(data);
  }

  invalidate(): void { /* önbellek yok */ }
}

class Screen {
  active = false;
  private tui: TuiAltScreen | null = null;
  private transcript = new Transcript();
  private bottom = new Bottom();
  private scroller: ScrollView | null = null;
  private consoleRestore: (() => void) | null = null;

  start(logFile?: (text: string) => void): void {
    if (this.active || !process.stdout.isTTY) return;
    this.active = true;
    // Gerçek imleç gösterilir (giriş kutusundaki yerinde; IME ve ekran okuyucular için)
    const tui = new TuiAltScreen(new ProcessTerminal(), true, undefined, {
      scrollToEndIndicator: () => ` ${c.brand('↓')} ${c.text('en alta in')} ${c.muted('Ctrl+End')} `,
      // Sürükleyerek seçilen metin panoya: önce sistem panosu, olmazsa terminalin OSC 52'si
      copySelection: async (text: string) => (await writeClipboard(text)) || false,
      onRightClickPaste: () => {
        void readClipboard().then((clip) => { if (clip !== null) dispatchPaste(clip); });
      },
    });
    this.tui = tui;
    this.scroller = new ScrollView(this.transcript, { follow: 'end', primary: true, overscroll: 'chain', scrollbar: 'auto' });
    this.transcript.viewHeight = () => Math.max(1, (process.stdout.rows || 24) - this.bottom.height);
    tui.setLayoutRoot(new VStack([
      { component: this.scroller, basis: 0, grow: 1, minSize: 2 },
      { component: this.bottom, basis: 'auto', shrink: 1, minSize: 1 },
    ]));
    tui.setFocus(this.bottom);
    this.captureConsole(logFile);
    tui.start();
  }

  /** Alternatif ekrandan çıkar; sohbet terminalin geçmişine yazılır. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.bottom.closing = true;
    this.transcript.closing = true;
    // pi-tui'nin kendi döküm yerine sohbetin kendisi terminal geçmişine yazılır
    const rows = this.transcript.entries.length ? this.transcript.render(Math.max(20, columns() - 1)) : [];
    this.tui?.stop({ preserveScreen: true });
    this.tui = null;
    if (rows.length) process.stdout.write(`${rows.map((r) => `${r}\x1b[0m`).join('\n')}\n\n`);
    this.consoleRestore?.();
    this.consoleRestore = null;
  }

  /**
   * Kütüphanelerin console.log/error çıktısı ekranın ortasına düşüp onu bozmasın:
   * oturum boyunca günlük dosyasına yönlendirilir.
   */
  private captureConsole(log?: (text: string) => void): void {
    const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    const sink = (...args: unknown[]): void => {
      try {
        log?.(args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      } catch { /* günlük yazılamazsa sessiz */ }
    };
    console.log = console.info = console.warn = console.error = console.debug = sink;
    this.consoleRestore = () => Object.assign(console, orig);
  }

  setFooter(fn: () => string): void { this.bottom.footer = fn; this.schedule(); }
  setEmptyView(fn: (w: number, h: number) => string[]): void { this.transcript.emptyView = fn; this.schedule(); }

  setSlot(slot: Slot, lines: string[] | null): void {
    if (lines && lines.length) this.bottom.slots.set(slot, lines);
    else this.bottom.slots.delete(slot);
    this.schedule();
  }

  setInput(lines: string[] | null, cursor: Cursor | null = null): void {
    this.bottom.input = lines ? { lines, cursor } : null;
    this.schedule();
  }

  append(line: Entry): void {
    this.transcript.append(line);
    this.schedule();
  }

  get isEmpty(): boolean {
    return !this.transcript.entries.length;
  }

  /** Sohbet görünümünü temizler, karşılama ekranına döner. */
  clearTranscript(): void {
    this.transcript.clear();
    this.scroller?.scrollToEnd();
    this.schedule();
  }

  /** Sohbeti kaydırır: eksi yukarı (eskiye), artı aşağı. */
  scroll(delta: number): void {
    this.tui?.scrollBy(delta);
  }

  scrollToBottom(): void {
    this.scroller?.scrollToEnd();
    this.schedule();
  }

  get scrolled(): boolean {
    return !!this.scroller && !this.scroller.isFollowingEnd;
  }

  private schedule(): void {
    this.tui?.requestRender();
  }
}

export const screen = new Screen();

/** Sohbete kalıcı satır ekler (ekran yönetimi yoksa doğrudan yazar). */
export function print(text = ''): void {
  if (screen.active) {
    for (const line of text.replace(/\n$/, '').split('\n')) screen.append(line);
  } else {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}

const USER_BG = bg('#262C36');
const USER_MAX_ROWS = 12;

/**
 * Kullanıcının mesajı Claude Code'daki gibi arka planlı bir kutuda: "❯ metin", satır boyu dolu.
 * Çok uzun (yapıştırılmış) mesajın ilk satırları görünür.
 */
export function printUserMessage(text: string, mark: string = c.muted('❯')): void {
  const block: Block = (w) => {
    const inner = Math.max(10, w - 4);
    let rows = text.replace(/\s+$/, '').split('\n').flatMap((l) => wrapAnsi(c.text(l), inner, 0));
    const more = rows.length - USER_MAX_ROWS;
    if (more > 0) rows = [...rows.slice(0, USER_MAX_ROWS - 1), c.muted(`… ${more + 1} satır daha`)];
    return rows.map((r, i) => {
      const line = ` ${i === 0 ? mark : ' '} ${r}`;
      return USER_BG(`${line}${' '.repeat(Math.max(0, w - textWidth(line)))}`);
    });
  };
  if (screen.active) screen.append(block);
  else process.stdout.write(`${block(columns() - 1).join('\n')}\n`);
}

const FRAMES = ['✶', '✸', '✹', '✺', '✹', '✷'];
const WORDS = ['Düşünüyor', 'Okuyor', 'Tartıyor', 'Kuruyor', 'Bağlıyor', 'Toparlıyor'];

/** Model yanıt üretirken dönen gösterge: renkli yıldız, kayan degrade yazı, geçen süre. */
export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private started = 0;
  private word = WORDS[0];
  label = '';

  start(label?: string): void {
    this.label = label ?? '';
    if (this.timer) return;
    this.started = Date.now();
    this.word = WORDS[Math.floor(Math.random() * WORDS.length)];
    this.timer = setInterval(() => this.render(), 90);
    this.render();
  }

  private render(): void {
    this.frame++;
    const secs = Math.floor((Date.now() - this.started) / 1000);
    const star = gradient(FRAMES[this.frame % FRAMES.length], BRAND, this.frame % 4, 3);
    const text = gradient(`${this.label || this.word}…`, BRAND, this.frame % 12, 14);
    screen.setSlot('spinner', [`${star} ${text} ${dim(c.muted(`(${secs} sn · Esc ile durdur)`))}`]);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    screen.setSlot('spinner', null);
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
