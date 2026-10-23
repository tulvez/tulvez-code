/**
 * Sohbet dışa aktarma: dosya adı.
 *   "README güncel değil, araç listesini düzelt" → "2026-10-23 README güncel değil araç listesini düzelt.md"
 * Windows ve macOS'ta geçersiz karakterler atılır; ad 80 karakterle sınırlanır.
 */
export function chatFileName(title: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clean = title
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[.,;!]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[\s.]+$/, '');
  return `${day} ${clean || 'Sohbet'}.md`;
}
