import * as fs from 'fs';
import * as path from 'path';

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache', 'coverage', '.idea', '.vscode',
  'vendor', '__pycache__', '.venv', 'venv', 'target', '.turbo', '.svelte-kit',
]);
const MAX_FILES = 5000;
const TTL_MS = 30_000;

let cache: { root: string; files: string[]; at: number } | null = null;

/** Çalışma klasöründeki dosyalar (göreli, / ayraçlı); @ önerileri için, 30 sn önbellekli. */
export function workspaceFiles(root: string): string[] {
  if (cache && cache.root === root && Date.now() - cache.at < TTL_MS) return cache.files;
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (files.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        files.push(`${r}/`);
        walk(path.join(dir, e.name), r);
      } else if (e.isFile()) {
        files.push(r);
      }
    }
  };
  walk(root, '');
  cache = { root, files, at: Date.now() };
  return files;
}

export function invalidateFiles(): void {
  cache = null;
}

/** Sorguya en uygun dosyalar: ad başta eşleşen önce, sonra yolda geçen; kısa yol önce. */
export function matchFiles(files: string[], query: string, limit = 50): string[] {
  const q = query.toLowerCase();
  const scored: { f: string; s: number }[] = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    const base = lower.replace(/\/$/, '').split('/').pop() ?? lower;
    let s = -1;
    if (!q) s = 3;
    else if (base.startsWith(q)) s = 0;
    else if (base.includes(q)) s = 1;
    else if (lower.includes(q)) s = 2;
    if (s >= 0) scored.push({ f, s });
  }
  scored.sort((a, b) => a.s - b.s || a.f.length - b.f.length || a.f.localeCompare(b.f));
  return scored.slice(0, limit).map((x) => x.f);
}
