import { normalizePaste, readClipboard, readClipboardImage, type ClipboardImage } from './clipboard';
import { isCtrlC, pushKeys, type Key } from './keys';
import { screen } from './screen';
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

export interface EditorApi {
  getText(): string;
  setText(text: string): void;
  /** Yeniden çiz (yer tutucu gibi dışarıdan değişen durumlar için) */
  refresh(): void;
}

export interface EditorOptions {
  /** Kutu ve imleç rengi; yazılan metne göre değişebilir (ör. "!" kipi) */
  accent: (text: string) => Paint;
  placeholder?: string | (() => string);
  /** Esc (öneri listesi kapalıyken); true dönerse tüketildi (ör. yanıt durduruldu) */
  onEscape?: () => boolean;
  /** Ctrl+C, giriş boşken; true dönerse tüketildi (ör. yanıt durduruldu) */
  onCtrlC?: () => boolean;
  /** Ctrl+S; true dönerse tüketildi (ör. yanıtı durdurup sıradakini hemen gönder) */
  onSendNow?: (text: string) => boolean;
  /** Panoda görsel varsa (Ctrl+V / Alt+V) çağrılır; kutuya konacak işareti döndürür. Yoksa görsel alınmaz. */
  onImage?: (image: ClipboardImage) => string;
  /** Kutunun metnine dışarıdan erişim (sıradaki mesajları kutuya geri koymak için) */
  bind?: (api: EditorApi) => void;
  history?: string[];
  suggest?: (text: string, cursor: number) => SuggestionSet | null;
  /** Shift+Tab */
  onShiftTab?: () => void;
  /** Gizli giriş (API anahtarı) */
  mask?: boolean;
  /** Kutunun üstündeki başlık */
  label?: string;
  /** Tek satır: Enter her zaman gönderir */
  singleLine?: boolean;
  /** Gönderildikten sonra kutu bu yer tutucuyla (soluk) kalır; yoksa kutu kaldırılır */
  idlePlaceholder?: string;
}

export type EditorResult = { text: string } | { exit: true } | null;

const MAX_SUGGESTIONS = 8;
const PROMPT = '❯';

interface BoxLayout { lines: string[]; cursor: { row: number; col: number } }

/** Giriş kutusunun satırları; metin kutu genişliğinde satırlara bölünür, imleç konumu hesaplanır. */
export function layoutBox(chars: string[], cursor: number, opts: {
  accent: Paint; placeholder?: string; mask?: boolean; label?: string; idle?: boolean;
}): BoxLayout {
  const cols = columns();
  const boxW = cols - 1;
  const inner = boxW - 4;
  const textW = Math.max(8, inner - 2);
  const accent = opts.idle ? (t: string) => dim(c.muted(t)) : opts.accent;
  const rows: string[] = [];
  let curRow = 0;
  let curCol = 0;
  const logical = chars.join('').split('\n');
  let offset = 0;
  logical.forEach((line, li) => {
    const prefix = li === 0 ? `${accent(PROMPT)} ` : '  ';
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
    rows[0] = `${accent(PROMPT)} ${dim(c.muted(fit(opts.placeholder, textW).trimEnd()))}`;
  }
  // Çok uzun girişte kutu en çok 10 satır; imlecin olduğu bölüm görünür
  const MAX_ROWS = 10;
  let shown = rows;
  let shift = 0;
  if (rows.length > MAX_ROWS) {
    shift = Math.min(Math.max(0, curRow - MAX_ROWS + 1), rows.length - MAX_ROWS);
    shown = rows.slice(shift, shift + MAX_ROWS);
  }
  const lines: string[] = [];
  if (opts.label) lines.push(` ${bold(opts.label)}`);
  const head = lines.length;
  lines.push(accent(`╭${'─'.repeat(boxW - 2)}╮`));
  for (const r of shown) {
    const pad = Math.max(0, inner - width(r));
    lines.push(`${accent('│')} ${r}${' '.repeat(pad)} ${accent('│')}`);
  }
  lines.push(accent(`╰${'─'.repeat(boxW - 2)}╯`));
  return { lines, cursor: { row: head + 1 + curRow - shift, col: 2 + 2 + curCol } };
}

/** Yanıt sürerken altta duran soluk kutu. */
export function showIdleBox(placeholder: string): void {
  screen.setInput(layoutBox([], 0, { accent: c.muted, placeholder, idle: true }).lines, null);
}

/**
 * Çerçeveli giriş kutusu. Enter gönderir; satır sonundaki `\` + Enter ya da yapıştırma yeni satır açar.
 * Dönüş: gönderilen metin, Esc ile vazgeçildiyse null, çıkış istendiyse { exit: true }.
 */
/** Bundan uzun yapıştırma kutuda katlanır */
const PASTE_FOLD_LINES = 10;

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

  // Uzun yapıştırma kutuda tek satırlık işaret olarak durur; gönderilince yerine metin konur
  const pastes: string[] = [];
  const marker = (i: number, lines: number): string => `[Yapıştırılan metin #${i + 1} · ${lines} satır]`;
  const expandPastes = (s: string): string =>
    pastes.reduce((acc, p, i) => acc.split(marker(i, p.split('\n').length)).join(p), s);
  const paste = (raw: string): void => {
    const t = normalizePaste(raw, !!(opts.singleLine || opts.mask));
    const lines = t.split('\n').length;
    if (lines > PASTE_FOLD_LINES && !opts.singleLine && !opts.mask) {
      pastes.push(t);
      insert(marker(pastes.length - 1, lines));
    } else {
      insert(t);
    }
    suggDismissed = false;
    updateSuggestions();
  };

  const updateSuggestions = (): void => {
    if (suggDismissed || !opts.suggest) { sugg = null; return; }
    const next = opts.suggest(text(), cursor);
    sugg = next && next.items.length ? next : null;
    if (suggIndex >= (sugg?.items.length ?? 0)) suggIndex = 0;
  };

  const render = (): void => {
    const cols = columns();
    const accent = opts.accent(text());
    const placeholder = typeof opts.placeholder === 'function' ? opts.placeholder() : opts.placeholder;
    const box = layoutBox(chars, cursor, { accent, placeholder, mask: opts.mask, label: opts.label });
    if (sugg) {
      const list = sugg.items.slice(0, MAX_SUGGESTIONS);
      const labelW = Math.min(28, Math.max(...list.map((s) => width(s.label))) + 2);
      const lines = list.map((s, i) => {
        const sel = i === suggIndex;
        const label = fit(s.label, labelW);
        const hint = s.hint ? fit(s.hint, Math.max(0, cols - labelW - 6)).trimEnd() : '';
        return sel ? `  ${accent('❯')} ${bold(accent(label))}${c.muted(hint)}` : `    ${c.text(label)}${dim(c.muted(hint))}`;
      });
      if (sugg.items.length > MAX_SUGGESTIONS) lines.push(`    ${c.muted(`… ${sugg.items.length - MAX_SUGGESTIONS} tane daha, yazarak daralt`)}`);
      screen.setSlot('suggest', lines);
    } else {
      screen.setSlot('suggest', null);
    }
    screen.setSlot('notice', notice ? [`  ${c.yellow(notice)}`] : null);
    screen.setInput(box.lines, box.cursor);
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
  const deleteWord = (): void => {
    let i = cursor;
    while (i > 0 && /\s/.test(chars[i - 1])) i--;
    while (i > 0 && !/\s/.test(chars[i - 1])) i--;
    chars.splice(i, cursor - i);
    cursor = i;
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
    let finished = false;
    /** Ctrl+V terminal tarafından yapıştırılmadan düz tuş geldiyse (cmd, VS Code): pano okunur. */
    const pasteFromClipboard = (): void => {
      void (async () => {
        // Önce görsel (ekran görüntüsü): panoda varsa işaret konur, gönderince modele gider
        if (opts.onImage && !opts.mask && !opts.singleLine) {
          const img = await readClipboardImage();
          if (finished) return;
          if (img) {
            insert(`${opts.onImage(img)} `);
            render();
            return;
          }
        }
        return readClipboard();
      })().then((clip) => {
        if (finished || clip === undefined) return;
        if (clip === null) {
          notice = 'Pano okunamadı — terminalin kendi yapıştırmasını dene (Windows Terminal: Ctrl+Shift+V)';
        } else {
          paste(clip);
        }
        render();
      });
    };

    const done = (result: EditorResult): void => {
      finished = true;
      release();
      process.stdout.off('resize', onResize);
      screen.setSlot('suggest', null);
      screen.setSlot('notice', null);
      if (opts.idlePlaceholder !== undefined) showIdleBox(opts.idlePlaceholder);
      else screen.setInput(null);
      resolve(result);
    };

    const onKey = (ch: string | undefined, key: Key): void => {
      notice = '';
      const now = Date.now();
      if (isCtrlC(key)) {
        if (chars.length) { setText(''); sugg = null; }
        else if (opts.onCtrlC?.()) return render();
        else if (now - lastCtrlC < 1500) return done({ exit: true });
        else { lastCtrlC = now; notice = 'Çıkmak için Ctrl+C\'ye yeniden bas'; }
        return render();
      }
      if (key.ctrl && key.name === 'd' && !chars.length) return done({ exit: true });
      if ((key.ctrl || key.meta) && key.name === 'v') return pasteFromClipboard();
      if (key.ctrl && key.name === 's' && opts.onSendNow?.(text())) return render();
      if (key.name === 'escape') {
        if (sugg) { sugg = null; suggDismissed = true; return render(); }
        if (opts.mask || opts.singleLine) return done(null);
        if (opts.onEscape?.()) return render();
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
        const value = expandPastes(text());
        if (!value.trim() && !opts.mask) return render();
        if (value.trim() && !opts.mask && history[history.length - 1] !== value) history.push(value);
        screen.scrollToBottom();
        return done({ text: opts.mask ? value.trim() : value.replace(/\s+$/, '') });
      }
      if (key.name === 'paste') {
        paste(key.sequence ?? '');
        return render();
      }
      if (key.name === 'backspace') {
        if (key.meta || key.ctrl) deleteWord(); // Alt/Ctrl+Backspace: kelime sil
        else if (cursor > 0) {
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
      } else if ((key.name === 'home' && !key.ctrl) || (key.ctrl && key.name === 'a')) {
        cursor = lineStart();
      } else if ((key.name === 'end' && !key.ctrl) || (key.ctrl && key.name === 'e')) {
        cursor = lineEnd();
      } else if (key.ctrl && key.name === 'u') {
        const start = lineStart();
        chars.splice(start, cursor - start);
        cursor = start;
      } else if (key.ctrl && key.name === 'w') {
        deleteWord();
      } else if ((key.name === 'up' || (key.ctrl && key.name === 'p')) && !opts.mask) {
        if (lineStart() > 0 && !key.ctrl) {
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
      } else if ((key.name === 'down' || (key.ctrl && key.name === 'n')) && !opts.mask) {
        if (lineEnd() < chars.length && !key.ctrl) {
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
    opts.bind?.({
      getText: text,
      setText: (s) => {
        if (finished) return;
        setText(s);
        updateSuggestions();
        render();
      },
      refresh: () => {
        if (!finished) render();
      },
    });
    updateSuggestions();
    render();
  });
}
