import { onScroll } from './keys';
import { BRAND, c, columns, dim, gradient, truncateAnsi, wrapAnsi, width } from './theme';

/**
 * Tam ekran düzeni (alternatif ekran tamponu; çıkınca terminal eski haline döner):
 *
 *   ┌ sohbet (kaydırılabilir; boşken karşılama ekranı) ┐
 *   │ panel: kurulum adımları, düşünme göstergesi,     │
 *   │        seçim listesi, öneriler, uyarı             │
 *   │ giriş kutusu (hep altta, sabit)                   │
 *   └ durum satırı                                     ┘
 *
 * Her çizimde yalnız değişen satırlar yazılır.
 */

type Slot = 'setup' | 'spinner' | 'select' | 'suggest' | 'notice';
const SLOT_ORDER: Slot[] = ['setup', 'spinner', 'select', 'suggest', 'notice'];

interface Cursor { row: number; col: number }

class Screen {
  active = false;
  private entries: string[] = [];
  /** Satırlara bölünmüş sohbet; genişlik değişince baştan bölünür */
  private rows: string[] = [];
  private rowsWidth = 0;
  private wrapped = 0;
  /** Alttan kaç satır yukarı kaydırıldı (0 = en altı izle) */
  private offset = 0;
  private slots = new Map<Slot, string[]>();
  private input: { lines: string[]; cursor: Cursor | null } | null = null;
  /** `compact`: yalnız sol bölüm (sağda kaydırma uyarısı varken) */
  private footer: (compact: boolean) => string = () => '';
  private empty: (w: number, h: number) => string[] = () => [];
  private last: string[] = [];
  private pending = false;

  start(): void {
    if (this.active || !process.stdout.isTTY) return;
    this.active = true;
    // Alternatif ekran + fare tekerleği (SGR); metin seçmek için Shift+sürükle
    process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2J\x1b[H');
    process.stdout.on('resize', this.onResize);
    onScroll((delta) => this.scroll(delta));
    process.once('exit', () => this.stop());
    this.render();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    process.stdout.off('resize', this.onResize);
    process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l');
  }

  private onResize = (): void => {
    this.last = [];
    this.rowsWidth = 0;
    this.render();
  };

  setFooter(fn: (compact: boolean) => string): void { this.footer = fn; this.schedule(); }
  setEmptyView(fn: (w: number, h: number) => string[]): void { this.empty = fn; this.schedule(); }

  setSlot(slot: Slot, lines: string[] | null): void {
    if (lines && lines.length) this.slots.set(slot, lines);
    else this.slots.delete(slot);
    this.schedule();
  }

  setInput(lines: string[] | null, cursor: Cursor | null = null): void {
    this.input = lines ? { lines, cursor } : null;
    this.schedule();
  }

  append(line: string): void {
    this.entries.push(line);
    // Kullanıcı yukarıdaysa görünüm yerinde kalsın
    if (this.offset > 0) this.offset += wrapAnsi(line, this.textWidth(), 2).length;
    this.schedule();
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  clearTranscript(): void {
    this.entries = [];
    this.rows = [];
    this.wrapped = 0;
    this.offset = 0;
    this.last = []; // tam yeniden çizim
    process.stdout.write('\x1b[2J');
    this.schedule();
  }

  scroll(delta: number): void {
    const max = Math.max(0, this.rows.length - this.transcriptHeight());
    this.offset = Math.max(0, Math.min(max, this.offset + delta));
    this.schedule();
  }

  private textWidth(): number {
    return columns() - 1;
  }

  private transcriptHeight(): number {
    return Math.max(3, (process.stdout.rows || 24) - this.bottom().length);
  }

  private bottom(): string[] {
    const out: string[] = [];
    for (const s of SLOT_ORDER) out.push(...(this.slots.get(s) ?? []));
    if (this.input) out.push(...this.input.lines);
    out.push(this.footerLine());
    return out;
  }

  /** Yukarı kaydırılmışken durum satırının sağında "aşağıda N satır" uyarısı (kısayolların yerine). */
  private footerLine(): string {
    if (!this.offset) return this.footer(false);
    const hint = c.yellow(`↓ ${this.offset} satır aşağıda · PgDn `);
    const left = truncateAnsi(this.footer(true), columns() - 1 - width(hint) - 2);
    return `${left}${' '.repeat(Math.max(2, columns() - 1 - width(left) - width(hint)))}${hint}`;
  }

  private schedule(): void {
    if (!this.active || this.pending) return;
    this.pending = true;
    setImmediate(() => {
      this.pending = false;
      this.render();
    });
  }

  private wrapAll(): void {
    const w = this.textWidth();
    if (this.rowsWidth !== w) {
      this.rows = [];
      this.wrapped = 0;
      this.rowsWidth = w;
    }
    for (; this.wrapped < this.entries.length; this.wrapped++) {
      this.rows.push(...wrapAnsi(this.entries[this.wrapped], w, 2));
    }
  }

  render(): void {
    if (!this.active) return;
    const H = process.stdout.rows || 24;
    const W = columns();
    this.wrapAll();
    let bottom = this.bottom();
    // Panel ekrana sığmazsa en az 3 sohbet satırı kalsın diye üstten kırpılır
    if (bottom.length > H - 3) bottom = bottom.slice(bottom.length - (H - 3));
    const th = H - bottom.length;

    let top: string[];
    if (!this.entries.length) {
      const view = this.empty(W, th);
      const padTop = Math.max(0, Math.floor((th - view.length) / 2));
      top = [...Array(padTop).fill(''), ...view].slice(0, th);
    } else {
      const max = Math.max(0, this.rows.length - th);
      if (this.offset > max) this.offset = max;
      const end = this.rows.length - this.offset;
      top = this.rows.slice(Math.max(0, end - th), end);
    }
    while (top.length < th) top.push('');

    // Hiçbir satır terminal genişliğini aşmamalı: aşan satır alta kırılır ve ekran eşlemesi bozulur
    const frame = [...top, ...bottom].map((row) => truncateAnsi(row, W - 1));
    let out = '\x1b[?2026h\x1b[?25l';
    for (let i = 0; i < H; i++) {
      const row = frame[i] ?? '';
      if (this.last[i] !== row) out += `\x1b[${i + 1};1H\x1b[2K${row}`;
    }
    this.last = frame;
    const cur = this.input?.cursor;
    if (cur) {
      // Giriş kutusu durum satırının hemen üstünde biter
      const r = th + bottom.length - 1 - this.input!.lines.length + cur.row;
      out += `\x1b[${r + 1};${cur.col + 1}H\x1b[?25h`;
    }
    out += '\x1b[?2026l';
    process.stdout.write(out);
  }
}

export const screen = new Screen();

/** Sohbete kalıcı satır ekler (tam ekran yoksa doğrudan yazar). */
export function print(text = ''): void {
  if (screen.active) {
    for (const line of text.replace(/\n$/, '').split('\n')) screen.append(line);
  } else {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
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
