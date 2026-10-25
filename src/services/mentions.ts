import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Mesajdaki @dosya bağlantıları: "@src/app.ts" yazılan dosyanın içeriği (klasörse içindekiler)
 * mesaja eklenir. Yalnız çalışma alanındaki yollar okunur; bulunamayan @ yazısı olduğu gibi kalır
 * (e-posta adresi, @kullanıcı gibi).
 */

const MENTION_RE = /(^|\s)@((?:[\w.\-]+[\\/])*[\w.\-]+[\\/]?)/g;
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 60_000;
const MAX_MENTIONS = 10;

export function findMentions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const p = m[2].replace(/\\/g, '/').replace(/\/$/, '');
    if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, MAX_MENTIONS);
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Mesaja eklenecek bağlam bölümü; geçerli @ yoksa boş. */
export async function mentionContext(text: string, root: string | undefined): Promise<string> {
  if (!root) return '';
  const blocks: string[] = [];
  let left = MAX_TOTAL_CHARS;
  for (const rel of findMentions(text)) {
    if (left <= 0) break;
    const abs = path.resolve(root, rel);
    if (!inside(root, abs)) continue;
    let stat;
    try {
      // Sembolik bağla çalışma alanı dışına çıkılamaz
      if (!inside(await fs.realpath(root), await fs.realpath(abs))) continue;
      stat = await fs.stat(abs);
    } catch { continue; }
    if (stat.isDirectory()) {
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const list = entries
        .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, 200)
        .map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`)
        .join('\n');
      blocks.push(`<klasör yol="${rel}/">\n${list}\n</klasör>`);
      left -= list.length;
      continue;
    }
    if (stat.size > 2 * 1024 * 1024) {
      blocks.push(`<dosya yol="${rel}">(dosya çok büyük, ${Math.round(stat.size / 1024)} KB — gerekirse read_file ile parça parça oku)</dosya>`);
      continue;
    }
    const content = await fs.readFile(abs, 'utf8');
    if (content.includes('\u0000')) {
      blocks.push(`<dosya yol="${rel}">(ikili dosya, okunmadı)</dosya>`);
      continue;
    }
    const limit = Math.min(MAX_FILE_CHARS, left);
    const body = content.length > limit ? `${content.slice(0, limit)}\n… (kısaltıldı; devamı için read_file)` : content;
    blocks.push(`<dosya yol="${rel}">\n${body}\n</dosya>`);
    left -= body.length;
  }
  if (!blocks.length) return '';
  return `Kullanıcının mesajda andığı dosyalar:\n\n${blocks.join('\n\n')}`;
}
