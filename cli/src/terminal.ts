/**
 * Terminal çıktısı. Yanıt metni stdout'a, araç adımları ve durum satırları stderr'e gider:
 * `tulvez -p "…" > yanit.md` yalnız yanıtı yazar.
 */

const useColor = (stream: NodeJS.WriteStream): boolean =>
  Boolean(stream.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const paint = (code: string) => (text: string, stream: NodeJS.WriteStream = process.stderr): string =>
  useColor(stream) ? `\x1b[${code}m${text}\x1b[0m` : text;

export const dim = paint('2');
export const bold = paint('1');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');

/** Bir satırı stderr'e yazar. */
export function note(text: string): void {
  process.stderr.write(`${text}\n`);
}

export function errorLine(text: string): void {
  note(red(`✗ ${text}`));
}

export function warnLine(text: string): void {
  note(yellow(`! ${text}`));
}

const TOOL_LABELS: Record<string, string> = {
  read_file: 'Okunuyor',
  read_files: 'Okunuyor',
  list_files: 'Listeleniyor',
  list_dir: 'Listeleniyor',
  grep_files: 'Aranıyor',
  write_file: 'Yazılıyor',
  replace_in_file: 'Düzenleniyor',
  run_command: 'Komut',
  run_in_background: 'Arka planda',
  stop_background: 'Durduruluyor',
  web_fetch: 'İndiriliyor',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/** Çok satırlı çıktının ilk birkaç satırı, girintili ve sönük. */
export function outputPreview(output: string, maxLines = 6): string {
  const lines = output.replace(/\s+$/, '').split(/\r?\n/);
  const shown = lines.slice(0, maxLines).map((l) => `    ${l.slice(0, 200)}`);
  if (lines.length > maxLines) shown.push(`    … (${lines.length - maxLines} satır daha)`);
  return shown.join('\n');
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '';
  return usd < 0.01 ? ` · <$0.01` : ` · $${usd.toFixed(2)}`;
}
