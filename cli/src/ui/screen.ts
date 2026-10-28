import { BRAND, c, columns, dim, gradient, truncateAnsi, wrapAnsi } from './theme';

/**
 * Tam ekran düzeni (Claude Code / opencode gibi): açılınca terminalin alternatif ekranına geçilir,
 * önceki komutlar görünmez; çıkınca terminal eski haline döner.
 *
 *   ┌ sohbet görünümü — kendi kaydırması var (tekerlek, ↑↓, PgUp/PgDn)
 *   │ panel (kurulum adımları, düşünme göstergesi, sıra, seçim listesi, öneriler, uyarı)
 *   │ giriş kutusu                                  ← kaydırmaya katılmaz, hep altta
 *   └ durum satırı                                  ← ekranın son satırı
 *
 * Fare izlenmez (Windows'ta fare olayları gelmiyor; seçme ve sağ tıkla yapıştırma terminalde kalsın
 * diye): alternatif ekranda terminal tekerleği ok tuşuna çevirir (DECSET 1007), ok tuşları sohbeti kaydırır.
 * Sohbet boşken görünümün ortasında karşılama ekranı durur.
 */

type Slot = 'setup' | 'stream' | 'spinner' | 'queue' | 'select' | 'suggest' | 'notice';
const SLOT_ORDER: Slot[] = ['setup', 'stream', 'spinner', 'queue', 'select', 'suggest', 'notice'];

interface Cursor { row: number; col: number }

/** Bellekte tutulan en çok sohbet satırı (eskiler atılır) */
const MAX_LINES = 20_000;

function rowsCount(): number {
  return Math.max(8, process.stdout.rows || 24);
}

class Screen {
  active = false;
  /** Sohbet boş: karşılama görünür */
  private empty = true;
  /** Sohbetin mantıksal satırları (renkli) ve ekran genişliğine bölünmüş hali */
  private lines: string[] = [];
  private rows: string[] = [];
  private wrapWidth = 0;
  /** Alttan kaç satır yukarı kaydırıldı (0 = en altta, yeni satırlar görünür) */
  private offset = 0;
  /** Son çizilen kare: yalnız değişen satırlar yeniden yazılır (titreme olmaz, seçim bozulmaz) */
  private frame: string[] = [];
  private viewHeight = 0;
  private slots = new Map<Slot, string[]>();
  private input: { lines: string[]; cursor: Cursor | null } | null = null;
  private footer: () => string = () => '';
  private emptyView: (w: number, h: number) => string[] = () => [];
  private scheduled = false;
  private consoleRestore: (() => void) | null = null;

  start(logFile?: (text: string) => void): void {
    if (this.active || !process.stdout.isTTY) return;
    this.active = true;
    this.frame = [];
    // Alternatif ekran + tekerlek ok tuşu olarak gelsin + ekranı temizle
    process.stdout.write('\x1b[?1049h\x1b[?1007h\x1b[H\x1b[2J');
    process.stdout.on('resize', this.onResize);
    process.once('exit', () => this.stop());
    this.captureConsole(logFile);
    this.flush();
  }

  /** Alternatif ekrandan çıkar; terminal açılmadan önceki haline döner. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    process.stdout.off('resize', this.onResize);
    process.stdout.write('\x1b[0m\x1b[?1007l\x1b[?1049l\x1b[?25h');
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

  private onResize = (): void => {
    // Boyut değişince terminal ekranı kendi kaydırmış olabilir: tamamı yeniden çizilir
    this.frame = [];
    process.stdout.write('\x1b[2J');
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
    this.lines.push(line);
    if (this.wrapWidth) {
      const added = wrapAnsi(line, this.wrapWidth, 2);
      this.rows.push(...added);
      // Yukarıdaysa okuduğu yer kaymasın
      if (this.offset) this.offset += added.length;
    }
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES);
      this.wrapWidth = 0;
    }
    this.empty = false;
    this.schedule();
  }

  get isEmpty(): boolean {
    return this.empty;
  }

  /** Sohbet görünümünü temizler, karşılama ekranına döner. */
  clearTranscript(): void {
    this.lines = [];
    this.rows = [];
    this.offset = 0;
    this.empty = true;
    this.schedule();
  }

  /** Sohbeti kaydırır: eksi yukarı (eskiye), artı aşağı. */
  scroll(delta: number): void {
    if (this.empty) return;
    this.offset = Math.max(0, this.offset - delta);
    this.schedule();
  }

  /** Bir sayfa (görünümün yüksekliği kadar) kaydırır. */
  page(direction: -1 | 1): void {
    this.scroll(direction * Math.max(1, this.viewHeight - 2));
  }

  scrollToBottom(): void {
    if (!this.offset) return;
    this.offset = 0;
    this.schedule();
  }

  get scrolled(): boolean {
    return this.offset > 0;
  }

  private schedule(): void {
    if (!this.active || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.flush();
    });
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
    const width = W - 1;
    if (width !== this.wrapWidth) {
      this.wrapWidth = width;
      this.rows = this.lines.flatMap((l) => wrapAnsi(l, width, 2));
    }

    let bottom = this.bottomLines().map((l) => truncateAnsi(l, width));
    // Sohbete en az iki satır kalsın
    if (bottom.length > H - 2) bottom = bottom.slice(bottom.length - (H - 2));
    const viewH = H - bottom.length;
    this.viewHeight = viewH;

    let view: string[];
    if (this.empty) {
      const welcome = this.emptyView(W, viewH).map((l) => truncateAnsi(l, width));
      const padTop = Math.max(0, Math.floor((viewH - welcome.length) / 2));
      view = [...Array(padTop).fill(''), ...welcome].slice(0, viewH);
    } else {
      const maxOffset = Math.max(0, this.rows.length - viewH);
      this.offset = Math.min(this.offset, maxOffset);
      const end = this.rows.length - this.offset;
      view = this.rows.slice(Math.max(0, end - viewH), end);
      if (this.offset) {
        // Aşağıda okunmamış satır var: görünümün son satırında hatırlatma
        const hint = `  ${c.brand('↓')} ${c.muted(`${this.offset} satır aşağıda · ↓ ya da PgDn ile in · Ctrl+End en alta`)}`;
        view[viewH - 1] = truncateAnsi(hint, width);
      }
    }
    while (view.length < viewH) view.push('');

    const next = [...view, ...bottom];
    let out = '\x1b[?2026h\x1b[?25l';
    for (let i = 0; i < H; i++) {
      const row = next[i] ?? '';
      if (this.frame[i] === row) continue;
      out += `\x1b[${i + 1};1H${row}\x1b[0m\x1b[K`;
    }
    this.frame = next;

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
