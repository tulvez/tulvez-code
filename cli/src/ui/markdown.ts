import { BRAND, bold, c, columns, dim, gradient, italic } from './theme';

/** Satır içi biçim: `kod`, **kalın**, [metin](adres). */
export function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, code: string) => c.code(code))
    .replace(/\*\*([^*]+)\*\*/g, (_m, b: string) => bold(b))
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_m, t: string, u: string) => `${c.blue(t)} ${dim(c.muted(`(${u})`))}`);
}

/**
 * Akan markdown yanıtını satır tamamlandıkça biçimlendirir. Yarım satır tamponda bekler;
 * araç çağrısı ya da yanıt sonu gelince `flush` ile yazılır.
 */
export class MarkdownStream {
  private buffer = '';
  private inCode = false;
  private firstLine = true;

  constructor(private readonly write: (line: string) => void) {}

  /** Yeni yanıt bloğu: ilk satır "●" ile başlar. */
  reset(): void {
    this.flush();
    this.firstLine = true;
    this.inCode = false;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.line(line);
    }
  }

  flush(): void {
    if (this.buffer) {
      const rest = this.buffer;
      this.buffer = '';
      this.line(rest);
    }
  }

  private emit(text: string): void {
    // Baştaki boş satırlar atlanır; ilk dolu satır ● ile işaretlenir
    if (this.firstLine) {
      if (!text.trim()) return;
      this.write(`${c.text('●')} ${text}`);
      this.firstLine = false;
      return;
    }
    this.write(`  ${text}`);
  }

  private line(raw: string): void {
    const line = raw.replace(/\r$/, '');
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      if (!this.inCode) {
        this.inCode = true;
        this.emit(c.muted(`╭─ ${fence[1] || 'kod'}`));
      } else {
        this.inCode = false;
        this.emit(c.muted('╰─'));
      }
      return;
    }
    if (this.inCode) {
      this.emit(`${c.muted('│')} ${c.code(line)}`);
      return;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/\*\*/g, '');
      this.emit(level === 1 ? bold(gradient(title, BRAND)) : level === 2 ? bold(c.brand(title)) : bold(title));
      return;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      this.emit(c.muted('─'.repeat(Math.min(40, columns() - 4))));
      return;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(bullet[2]);
      if (task) {
        const doneMark = task[1] !== ' ';
        this.emit(`${bullet[1]}${doneMark ? c.green('✓') : c.muted('○')} ${doneMark ? dim(inline(task[2])) : inline(task[2])}`);
      } else {
        this.emit(`${bullet[1]}${c.brand('•')} ${inline(bullet[2])}`);
      }
      return;
    }
    const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      this.emit(`${ordered[1]}${c.brand(`${ordered[2]}.`)} ${inline(ordered[3])}`);
      return;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      this.emit(`${c.violet('▎')} ${italic(c.muted(inline(quote[1])))}`);
      return;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
        this.emit(c.muted(line.replace(/[^|]/g, '─').replace(/\|/g, '┼')));
      } else {
        this.emit(line.split('|').map((cell) => inline(cell)).join(c.muted('│')));
      }
      return;
    }
    this.emit(inline(line));
  }
}
