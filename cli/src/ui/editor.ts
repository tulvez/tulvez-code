import { isCtrlC, pushKeys, type Key } from './keys';
import { live } from './screen';
import { type Paint, bold, c, charCols, columns, dim, fit, width } from './theme';

export interface Suggestion {
  label: string;
  hint?: string;
  /** Seçilince yerine yazılacak metin */
  insert: string;
  /** Seçilince hemen gönderilsin (argümansız komutlar) */
  submit?: boolean;
}

export interface SuggestionSet {
  items: Suggestion[];
  /** Değiştirilecek aralık (karakter dizini) */
  from: number;
  to: number;
}

export interface EditorOptions {
  /** Kutu ve imleç rengi */
  accent: () => Paint;
  /** Kutunun altındaki durum satırı */
  footer?: () => string;
  placeholder?: string;
  history?: string[];
  suggest?: (text: string, cursor: number) => SuggestionSet | null;
  /** Shift+Tab */
  onShiftTab?: () => void;
  /** Gizli giriş (API anahtarı) */
  mask?: boolean;
  /** Tek satırlı başlık (kutunun üstünde) */
  label?: string;
  /** Tek satır: Enter her zaman gönderir */
  singleLine?: boolean;
}

export type EditorResult = { text: string } | { exit: true } | null;

const MAX_SUGGESTIONS = 8;

/**
 * Çerçeveli giriş kutusu. Enter gönderir; satır sonundaki `\` + Enter ya da yapıştırma yeni satır açar.
 * Dönüş: gönderilen metin, Esc/Ctrl+C ile vazgeçildiyse null, çıkış istendiyse { exit: true }.
 */
export function readInput(opts: EditorOptions): Promise<EditorResult> {
  let chars: string[] = [];
  let cursor = 0;
  const history = opts.history ?? [];
  let histIndex = history.length;
  let draft = '';
  let sugg: SuggestionSet | null = null;
  let suggIndex = 0;
  let suggDismissed = false;
  let lastCtrlC = 0;
  let lastEsc = 0;
  let notice = '';

  const text = (): string => chars.join('');

  const updateSuggestions = (): void => {
    if (suggDismissed || !opts.suggest) { sugg = null; return; }
    const next = opts.suggest(text(), cursor);
    sugg = next && next.items.length ? next : null;
    if (suggIndex >= (sugg?.items.length ?? 0)) suggIndex = 0;
  };

  const render = (): void => {
    const cols = columns();
    const boxW = cols - 1;
    const inner = boxW - 4;
    const textW = Math.max(8, inner - 2);
    const accent = opts.accent();
    const rows: string[] = [];
    let curRow = 0;
    let curCol = 0;
    const logical = text().split('\n');
    let offset = 0;
    logical.forEach((line, li) => {
      const prefix = li === 0 ? accent('❯') + ' ' : '  ';
      const lineChars = [...line];
      let row = '';
      let used = 0;
      const startRow = rows.length;
      const pushRow = (): void => {
        rows.push(`${rows.length === startRow ? prefix : '  '}${row}`);
        row = '';
        used = 0;
      };
      lineChars.forEach((ch, i) => {
        const shown = opts.mask ? '•' : ch;
        const w = charCols(shown);
        if (used + w > textW) pushRow();
        if (offset + i === cursor) { curRow = rows.length; curCol = used; }
        row += shown;
        used += w;
      });
      if (offset + lineChars.length === cursor) {
        if (used >= textW) pushRow();
        curRow = rows.length;
        curCol = used;
      }
      pushRow();
      offset += lineChars.length + 1;
    });
    if (!chars.length && opts.placeholder) {
      rows[0] = `${accent('❯')} ${dim(c.muted(fit(opts.placeholder, textW).trimEnd()))}`;
    }

    const border = accent;
    const lines: string[] = [];
    if (opts.label) lines.push(` ${bold(opts.label)}`);
    const headerRows = lines.length;
    lines.push(border(`╭${'─'.repeat(boxW - 2)}╮`));
    for (const r of rows) {
      const pad = Math.max(0, inner - width(r));
      lines.push(`${border('│')} ${r}${' '.repeat(pad)} ${border('│')}`);
    }
    lines.push(border(`╰${'─'.repeat(boxW - 2)}╯`));
    if (sugg) {
      const list = sugg.items.slice(0, MAX_SUGGESTIONS);
      const labelW = Math.min(28, Math.max(...list.map((s) => width(s.label))) + 2);
      list.forEach((s, i) => {
        const sel = i === suggIndex;
        const label = fit(s.label, labelW);
        const hint = s.hint ? fit(s.hint, Math.max(0, cols - labelW - 6)).trimEnd() : '';
        lines.push(sel ? `  ${accent('❯')} ${bold(accent(label))}${c.muted(hint)}` : `    ${c.text(label)}${dim(c.muted(hint))}`);
      });
      if (sugg.items.length > MAX_SUGGESTIONS) lines.push(`    ${c.muted(`… ${sugg.items.length - MAX_SUGGESTIONS} tane daha, yazarak daralt`)}`);
    } else if (notice) {
      lines.push(`  ${c.yellow(notice)}`);
    } else if (opts.footer) {
      lines.push(opts.footer());
    }
    // İmleç: başlık + üst kenar + içerik satırı; sütun: "│ " + önek (2)
    live.draw(lines, { row: headerRows + 1 + curRow, col: 2 + 2 + curCol });
  };

  const insert = (s: string): void => {
    const add = [...s];
    chars.splice(cursor, 0, ...add);
    cursor += add.length;
  };

  const setText = (s: string): void => {
    chars = [...s];
    cursor = chars.length;
  };

  // İmlecin bulunduğu satırın başı/sonu (çok satırlı metinde Home/End)
  const lineStart = (): number => {
    let i = cursor;
    while (i > 0 && chars[i - 1] !== '\n') i--;
    return i;
  };
  const lineEnd = (): number => {
    let i = cursor;
    while (i < chars.length && chars[i] !== '\n') i++;
    return i;
  };

  const acceptSuggestion = (): Suggestion | null => {
    if (!sugg) return null;
    const s = sugg.items[suggIndex];
    if (!s) return null;
    chars.splice(sugg.from, sugg.to - sugg.from, ...s.insert);
    cursor = sugg.from + [...s.insert].length;
    sugg = null;
    return s;
  };

  return new Promise((resolve) => {
    const onResize = (): void => render();
    const done = (result: EditorResult): void => {
      release();
      process.stdout.off('resize', onResize);
      live.clear();
      resolve(result);
    };

    const onKey = (ch: string | undefined, key: Key): void => {
      notice = '';
      const now = Date.now();
      if (isCtrlC(key)) {
        if (chars.length) { setText(''); sugg = null; }
        else if (now - lastCtrlC < 1500) return done({ exit: true });
        else { lastCtrlC = now; notice = 'Çıkmak için Ctrl+C\'ye yeniden bas'; }
        return render();
      }
      if (key.ctrl && key.name === 'd' && !chars.length) return done({ exit: true });
      if (key.name === 'escape') {
        if (sugg) { sugg = null; suggDismissed = true; return render(); }
        if (opts.mask || opts.singleLine) return done(null);
        if (chars.length && now - lastEsc < 600) { setText(''); return render(); }
        lastEsc = now;
        if (chars.length) notice = 'Silmek için Esc\'ye yeniden bas';
        return render();
      }
      if (key.name === 'tab' && key.shift) { opts.onShiftTab?.(); return render(); }
      if (sugg && (key.name === 'up' || key.name === 'down')) {
        const n = Math.min(sugg.items.length, MAX_SUGGESTIONS);
        suggIndex = (suggIndex + (key.name === 'up' ? -1 : 1) + n) % n;
        return render();
      }
      if (sugg && key.name === 'tab') {
        acceptSuggestion();
        updateSuggestions();
        return render();
      }
      if (key.name === 'return' || key.name === 'enter') {
        if (sugg) {
          const s = acceptSuggestion();
          if (s?.submit) return done({ text: text().trim() });
          updateSuggestions();
          return render();
        }
        if (!opts.singleLine && cursor > 0 && chars[cursor - 1] === '\\') {
          chars.splice(cursor - 1, 1, '\n');
          return render();
        }
        const value = text();
        if (!value.trim() && !opts.mask) return render();
        if (value.trim() && !opts.mask && history[history.length - 1] !== value) history.push(value);
        return done({ text: opts.mask ? value.trim() : value.replace(/\s+$/, '') });
      }
      if (key.name === 'paste-newline') {
        if (!opts.singleLine) insert('\n');
        return render();
      }
      if (key.name === 'backspace') {
        if (key.meta || key.ctrl) {
          // Alt/Ctrl+Backspace: kelime sil
          let i = cursor;
          while (i > 0 && /\s/.test(chars[i - 1])) i--;
          while (i > 0 && !/\s/.test(chars[i - 1])) i--;
          chars.splice(i, cursor - i);
          cursor = i;
        } else if (cursor > 0) {
          chars.splice(cursor - 1, 1);
          cursor--;
        }
        suggDismissed = false;
      } else if (key.name === 'delete') {
        if (cursor < chars.length) chars.splice(cursor, 1);
      } else if (key.name === 'left') {
        cursor = Math.max(0, cursor - 1);
      } else if (key.name === 'right') {
        cursor = Math.min(chars.length, cursor + 1);
      } else if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
        cursor = lineStart();
      } else if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        cursor = lineEnd();
      } else if (key.ctrl && key.name === 'u') {
        chars.splice(lineStart(), cursor - lineStart());
        cursor = lineStart();
      } else if (key.ctrl && key.name === 'w') {
        let i = cursor;
        while (i > 0 && /\s/.test(chars[i - 1])) i--;
        while (i > 0 && !/\s/.test(chars[i - 1])) i--;
        chars.splice(i, cursor - i);
        cursor = i;
      } else if (key.name === 'up' && !opts.mask) {
        if (lineStart() > 0) {
          // çok satırlıda bir üst satıra
          const col = cursor - lineStart();
          const prevEnd = lineStart() - 1;
          let prevStart = prevEnd;
          while (prevStart > 0 && chars[prevStart - 1] !== '\n') prevStart--;
          cursor = Math.min(prevEnd, prevStart + col);
        } else if (histIndex > 0) {
          if (histIndex === history.length) draft = text();
          histIndex--;
          setText(history[histIndex]);
        }
      } else if (key.name === 'down' && !opts.mask) {
        if (lineEnd() < chars.length) {
          const col = cursor - lineStart();
          const nextStart = lineEnd() + 1;
          let nextEnd = nextStart;
          while (nextEnd < chars.length && chars[nextEnd] !== '\n') nextEnd++;
          cursor = Math.min(nextEnd, nextStart + col);
        } else if (histIndex < history.length) {
          histIndex++;
          setText(histIndex === history.length ? draft : history[histIndex]);
        }
      } else if (ch && !key.ctrl && !key.meta && (ch >= ' ' || ch === '\t')) {
        insert(ch === '\t' ? '  ' : ch);
        suggDismissed = false;
      } else {
        return;
      }
      updateSuggestions();
      render();
    };

    const release = pushKeys(onKey);
    process.stdout.on('resize', onResize);
    updateSuggestions();
    render();
  });
}
