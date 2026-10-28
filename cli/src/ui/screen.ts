import { BRAND, c, columns, dim, gradient, truncateAnsi, wrapAnsi } from './theme';

/**
 * Ekran düzeni: sohbet terminalin normal geçmişine yazılır (kaydırma, seçme, sağ tıkla yapıştırma
 * terminalin kendisinde çalışır); altta sabit bir bölge kalır:
 *
 *   … sohbet (terminal geçmişi) …
 *   ┌ bölge: panel (kurulum adımları, düşünme göstergesi, seçim listesi, öneriler, uyarı)
 *   │        giriş kutusu
 *   └        durum satırı                                  ← ekranın son satırı
 *
 * Bölge her zaman ekranın en altında biter. Sohbet boşken bölge bütün ekranı kaplar ve ortada
 * karşılama ekranı görünür; ilk mesajla karşılama silinir, sohbet üstten akmaya başlar.
 */

type Slot = 'setup' | 'stream' | 'spinner' | 'queue' | 'select' | 'suggest' | 'notice';
const SLOT_ORDER: Slot[] = ['setup', 'stream', 'spinner', 'queue', 'select', 'suggest', 'notice'];

interface Cursor { row: number; col: number }

function rowsCount(): number {
  return Math.max(8, process.stdout.rows || 24);
}

class Screen {
  active = false;
  /** Sohbet boş: bölge ekranın tamamı, karşılama görünür */
  private empty = true;
  /** Bölgenin satır sayısı (üstü = ekran yüksekliği − bu + 1) */
  private regionHeight = 0;
  private pendingRows: string[] = [];
  private slots = new Map<Slot, string[]>();
  private input: { lines: string[]; cursor: Cursor | null } | null = null;
  private footer: () => string = () => '';
  private emptyView: (w: number, h: number) => string[] = () => [];
  private scheduled = false;
  private consoleRestore: (() => void) | null = null;

  start(logFile?: (text: string) => void): void {
    if (this.active || !process.stdout.isTTY) return;
    this.active = true;
    this.empty = true;
    this.regionHeight = 0;
    process.stdout.on('resize', this.onResize);
    process.once('exit', () => this.stop());
    this.captureConsole(logFile);
    this.flush();
  }

  /** Bölgeyi siler; sohbet terminal geçmişinde kalır. */
  stop(): void {
    if (!this.active) return;
    this.flush();
    this.active = false;
    process.stdout.off('resize', this.onResize);
    process.stdout.write(`${this.eraseRegion()}\x1b[?25h`);
    this.regionHeight = 0;
    this.consoleRestore?.();
    this.consoleRestore = null;
  }

  /**
   * Kütüphanelerin console.log/error çıktısı bölgenin ortasına düşüp ekranı bozmasın:
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

  private onResize = (): void => {
    // Genişlik değişince eski bölge satırları terminalde kırılmış olabilir: ekranın altından
    // bölge yüksekliği kadar baştan çizilir
    this.regionHeight = Math.min(this.regionHeight, rowsCount());
    this.schedule();
  };

  setFooter(fn: () => string): void { this.footer = fn; this.schedule(); }
  setEmptyView(fn: (w: number, h: number) => string[]): void { this.emptyView = fn; this.schedule(); }

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
    this.pendingRows.push(...wrapAnsi(line, columns() - 1, 2));
    this.empty = false;
    this.schedule();
  }

  get isEmpty(): boolean {
    return this.empty && !this.pendingRows.length;
  }

  /** Karşılama ekranına dön; önceki sohbet terminal geçmişinde (yukarıda) kalır. */
  clearTranscript(): void {
    this.flush();
    this.empty = true;
    this.schedule();
  }

  private schedule(): void {
    if (!this.active || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  /** İmleci bölgenin üstüne götürüp aşağısını siler (bölge ekranın altında biter). */
  private eraseRegion(): string {
    if (!this.regionHeight) return '\r';
    const top = rowsCount() - this.regionHeight + 1;
    return `\x1b[${Math.max(1, top)};1H\x1b[J`;
  }

  private bottomLines(): string[] {
    const out: string[] = [];
    for (const s of SLOT_ORDER) out.push(...(this.slots.get(s) ?? []));
    if (this.input) out.push(...this.input.lines);
    out.push(this.footer());
    return out;
  }

  private flush(): void {
    if (!this.active) return;
    const H = rowsCount();
    const W = columns();
    let lines = this.bottomLines().map((l) => truncateAnsi(l, W - 1));
    if (lines.length > H) lines = lines.slice(lines.length - H);

    let out = `\x1b[?2026h\x1b[?25l${this.eraseRegion()}`;
    let space = this.regionHeight || H;

    // Yeni sohbet satırları bölgenin yerine yazılır, bölge onların altına iner
    if (this.pendingRows.length) {
      const rows = this.pendingRows;
      this.pendingRows = [];
      out += rows.map((r) => `${r}\x1b[0m\n`).join('');
      space = Math.max(0, space - rows.length);
    }

    let region: string[];
    if (this.empty) {
      // Karşılama: bölge bütün ekran, görünüm üst boşlukta dikey ortalanır
      const viewH = H - lines.length;
      const view = this.emptyView(W, viewH).map((l) => truncateAnsi(l, W - 1));
      const padTop = Math.max(0, Math.floor((viewH - view.length) / 2));
      const area = [...Array(padTop).fill(''), ...view].slice(0, viewH);
      while (area.length < viewH) area.push('');
      region = [...area, ...lines];
    } else {
      const pad = Math.max(0, space - lines.length);
      region = [...Array(pad).fill(''), ...lines];
    }
    out += region.join('\n');
    this.regionHeight = region.length;

    const cur = this.input?.cursor;
    if (cur) {
      // Giriş kutusu durum satırının hemen üstünde biter
      const row = H - 1 - this.input!.lines.length + cur.row + 1;
      out += `\x1b[${row};${cur.col + 1}H\x1b[?25h`;
    }
    out += '\x1b[?2026l';
    process.stdout.write(out);
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
