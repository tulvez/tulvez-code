import { isCtrlC, pushKeys } from './keys';
import { live, print } from './screen';
import { type Paint, bold, c, columns, dim, fit, width } from './theme';

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
  /** Satırın rengi (ör. mod rengi) */
  color?: Paint;
}

export interface SelectOptions<T> {
  title: string;
  /** Başlığın altında açıklama satırları (ör. çalıştırılacak komut) */
  detail?: string[];
  choices: Choice<T>[];
  initial?: number;
  /** Yazarak süzme (uzun listelerde) */
  filter?: boolean;
  /** Seçimden sonra kalıcı özet satırı yazılsın mı */
  summary?: boolean;
  accent?: Paint;
}

const VISIBLE = 10;

/**
 * Ok tuşlarıyla seçim. ↑↓ gezinir, Enter seçer, 1–9 doğrudan seçer, Esc vazgeçer (null).
 * `filter` açıkken yazılan harfler listeyi süzer.
 */
export function select<T>(opts: SelectOptions<T>): Promise<T | null> {
  const accent = opts.accent ?? c.brand;
  let index = Math.max(0, Math.min(opts.initial ?? 0, opts.choices.length - 1));
  let query = '';
  let top = 0;

  const visible = (): Choice<T>[] => {
    if (!query) return opts.choices;
    const q = query.toLocaleLowerCase('tr');
    return opts.choices.filter((ch) => `${ch.label} ${ch.hint ?? ''}`.toLocaleLowerCase('tr').includes(q));
  };

  const render = (): void => {
    const cols = columns() - 2;
    const list = visible();
    if (index >= list.length) index = Math.max(0, list.length - 1);
    if (index < top) top = index;
    if (index >= top + VISIBLE) top = index - VISIBLE + 1;
    const lines: string[] = [`${accent('?')} ${bold(opts.title)}`];
    for (const d of opts.detail ?? []) lines.push(`  ${fit(d, cols - 2)}`);
    if (opts.filter) lines.push(`  ${c.muted('Ara:')} ${query}${c.muted(query ? '' : 'yazarak süz')}`);
    if (!list.length) lines.push(`  ${c.muted('Eşleşen yok')}`);
    list.slice(top, top + VISIBLE).forEach((ch, i) => {
      const n = top + i;
      const selected = n === index;
      const num = list.length <= 9 && !opts.filter ? `${n + 1}. ` : '';
      const paint = ch.color ?? c.text;
      const label = `${num}${ch.label}`;
      const hintSpace = Math.max(0, cols - 4 - width(label) - 3);
      const hint = ch.hint && hintSpace > 6 ? `  ${c.muted(fit(ch.hint, Math.min(hintSpace, width(ch.hint))).trimEnd())}` : '';
      lines.push(selected ? `${accent('❯')} ${bold(paint(label))}${hint}` : `  ${dim(paint(label))}${hint}`);
    });
    if (list.length > VISIBLE) lines.push(`  ${c.muted(`${index + 1}/${list.length}`)}`);
    lines.push(`  ${c.muted('↑↓ seç · Enter onayla · Esc vazgeç')}`);
    live.draw(lines);
  };

  return new Promise((resolve) => {
    const finish = (value: Choice<T> | null): void => {
      release();
      live.clear();
      if (opts.summary !== false) {
        print(value ? `${c.green('✓')} ${c.muted(opts.title)} ${c.text(value.label)}` : `${c.muted('✗')} ${c.muted(opts.title)} ${c.muted('vazgeçildi')}`);
      }
      resolve(value ? value.value : null);
    };
    const release = pushKeys((ch, key) => {
      const list = visible();
      if (isCtrlC(key) || key.name === 'escape') return finish(null);
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) index = (index - 1 + list.length) % Math.max(1, list.length);
      else if (key.name === 'down' || key.name === 'tab' || (key.ctrl && key.name === 'n')) index = (index + 1) % Math.max(1, list.length);
      else if (key.name === 'pageup') index = Math.max(0, index - VISIBLE);
      else if (key.name === 'pagedown') index = Math.min(list.length - 1, index + VISIBLE);
      else if (key.name === 'return' || key.name === 'enter') {
        if (list[index]) return finish(list[index]);
      } else if (opts.filter) {
        if (key.name === 'backspace') query = query.slice(0, -1);
        else if (ch && !key.ctrl && !key.meta && ch >= ' ') { query += ch; index = 0; top = 0; }
      } else if (ch && /^[1-9]$/.test(ch) && Number(ch) <= list.length) {
        return finish(list[Number(ch) - 1]);
      }
      render();
    });
    render();
  });
}
