/**
 * Düzenleme önizlemesi için satır farkı: ortak baş ve son atılır, aradaki bölüm silinen/eklenen
 * satırlar olarak döner. replace_in_file tek bölgeyi değiştirdiği için bu yeterli ve hızlıdır;
 * birden çok bölge değiştiyse aralarındaki satırlar da "değişti" görünür (sayılar üst sınırdır).
 */
export interface LineDiff {
  added: number;
  removed: number;
  /** İlk değişen satırın numarası (1 tabanlı, yeni dosyada) */
  start: number;
  removedLines: string[];
  addedLines: string[];
}

export function lineDiff(before: string, after: string): LineDiff {
  // Dosya sonundaki satır sonu ayrı bir (boş) satır sayılmasın
  const lines = (t: string): string[] => (t === '' ? [] : t.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
  const a = lines(before);
  const b = lines(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const removedLines = a.slice(p, a.length - s);
  const addedLines = b.slice(p, b.length - s);
  return { added: addedLines.length, removed: removedLines.length, start: p + 1, removedLines, addedLines };
}

/** "3 satır eklendi, 1 satır silindi" */
export function diffSummary(d: LineDiff): string {
  const parts: string[] = [];
  if (d.added) parts.push(`${d.added} satır eklendi`);
  if (d.removed) parts.push(`${d.removed} satır silindi`);
  return parts.length ? parts.join(', ') : 'değişiklik yok';
}
