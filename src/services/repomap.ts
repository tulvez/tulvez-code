import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache',
  'coverage', '.vscode', '.idea', 'vendor', '__pycache__', '.venv', 'venv',
]);

const SYMBOL_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, kind: 'fn' },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/, kind: 'fn' },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/, kind: 'interface' },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)/, kind: 'type' },
  { re: /^\s*(?:export\s+)?(?:def|async\s+def)\s+([A-Za-z0-9_]+)/, kind: 'def' },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/, kind: 'func' },
];

interface RepoFile {
  rel: string;
  size: number;
  symbols: string[];
}

export interface RepoMapResult {
  text: string;
  fileCount: number;
  truncated: boolean;
}

/**
 * Çalışma alanının token bütçeli haritası: dosya ağacı + önemli semboller.
 * Aider'ın repo-map fikri, tamamen kendi uygulamamız.
 */
export async function buildRepoMap(maxChars = 6000): Promise<RepoMapResult> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return { text: '', fileCount: 0, truncated: false };

  const files: RepoFile[] = [];
  let skipped = 0;

  const walk = async (dir: string): Promise<void> => {
    let entries: import('fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length > 800) return;
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) { skipped++; continue; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|swift|c|cc|cpp|h|hpp|css|scss|json|md)$/i.test(e.name);
      if (!isCode) continue;
      let size = 0;
      try {
        const stat = await fs.stat(full);
        if (stat.size > 200000) { skipped++; continue; }
        size = stat.size;
      } catch { continue; }
      files.push({ rel: path.relative(root, full).replace(/\\/g, '/'), size, symbols: [] });
    }
  };
  await walk(root);

  files.sort((a, b) => b.size - a.size);
  const targets = files.slice(0, 120);

  await Promise.all(targets.map(async (f) => {
    try {
      const content = await fs.readFile(path.join(root, f.rel), 'utf8');
      const symbols: string[] = [];
      for (const line of content.split('\n')) {
        if (symbols.length >= 12) break;
        for (const p of SYMBOL_PATTERNS) {
          const m = p.re.exec(line);
          if (m) {
            symbols.push(`${p.kind} ${m[1]}`);
            break;
          }
        }
      }
      f.symbols = symbols;
    } catch { /* okunamayan dosya */ }
  }));

  const header = `Çalışma alanı haritası (${files.length} dosya${skipped ? `, ${skipped} hariç` : ''}):`;
  const lines: string[] = [header];
  let used = header.length;
  let truncated = false;

  for (const f of targets) {
    const entry = f.symbols.length ? `${f.rel} → ${f.symbols.join(', ')}` : f.rel;
    if (used + entry.length + 1 > maxChars) { truncated = true; break; }
    lines.push(entry);
    used += entry.length + 1;
  }

  return { text: lines.join('\n'), fileCount: files.length, truncated };
}