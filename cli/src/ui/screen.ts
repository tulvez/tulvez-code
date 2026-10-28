import { BRAND, c, dim, gradient } from './theme';

/**
 * Ekranın altındaki "canlı" bölge: giriş kutusu, seçim listesi ya da düşünme göstergesi.
 * Bölge her çizimde silinip yeniden yazılır; kalıcı çıktı (`print`) bölgenin üstüne eklenir.
 */
class LiveRegion {
  private rows = 0;
  /** İmlecin bölge başından kaç satır aşağıda olduğu */
  private cursorRow = 0;
  private lines: string[] = [];
  private cursor: { row: number; col: number } | null = null;

  /** Bölgeyi siler, imleci bölgenin başına getirir. */
  private erase(): string {
    if (!this.rows) return '';
    return `${this.cursorRow ? `\x1b[${this.cursorRow}A` : ''}\r\x1b[J`;
  }

  /** İmleç sondaysa (row/col yok) gizlenir; giriş kutusu imlecin yerini verir. */
  draw(lines: string[], cursor: { row: number; col: number } | null = null): void {
    this.lines = lines;
    this.cursor = cursor;
    let out = this.erase();
    out += lines.join('\n');
    this.rows = lines.length;
    this.cursorRow = Math.max(0, lines.length - 1);
    if (cursor) {
      const up = this.cursorRow - cursor.row;
      if (up > 0) out += `\x1b[${up}A`;
      out += `\x1b[${cursor.col + 1}G\x1b[?25h`;
      this.cursorRow = cursor.row;
    } else {
      out += '\x1b[?25l';
    }
    process.stdout.write(out);
  }

  clear(): void {
    if (!this.rows) return;
    process.stdout.write(`${this.erase()}\x1b[?25h`);
    this.rows = 0;
    this.cursorRow = 0;
    this.lines = [];
    this.cursor = null;
  }

  get active(): boolean {
    return this.rows > 0;
  }

  /** Kalıcı metni bölgenin üstüne yazar, bölgeyi altında yeniden çizer. */
  print(text: string): void {
    const lines = this.lines;
    const cursor = this.cursor;
    const had = this.rows > 0;
    if (had) this.clear();
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    if (had) this.draw(lines, cursor);
  }

  redraw(): void {
    if (this.rows) this.draw(this.lines, this.cursor);
  }
}

export const live = new LiveRegion();

/** Kalıcı satır yaz (canlı bölge varsa onun üstüne). */
export function print(text = ''): void {
  live.print(text);
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
    live.draw([`${star} ${text} ${dim(c.muted(`(${secs} sn · Esc ile durdur)`))}`]);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    live.clear();
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
