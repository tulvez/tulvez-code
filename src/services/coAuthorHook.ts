import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BOT_EMAIL, CO_AUTHOR_TRAILER } from './gitIdentity';

/**
 * Copilot gibi ek katkıcı, commit anında.
 *
 * VS Code, Copilot'un düzenlediği bir dosya commit'e girerse mesaja commit
 * sırasında, kutuda göstermeden `Co-authored-by: Copilot` ekler. Bu kanca
 * eklentilere açık değil; aynı davranış deponun `.git/hooks/prepare-commit-msg`
 * kancasıyla kurulur:
 *
 * - Tulvez Code'un yazdığı dosyalar `.git/tulvez-ai-edits` listesinde tutulur
 *   (deponun içinde değil, .git klasöründe; commit'e girmez).
 * - Commit'e giren (staged) dosyalardan biri listedeyse kanca satırı ekler.
 *   VS Code'dan, terminalden ya da başka bir araçtan atılan commit fark etmez.
 * - Depoda başka bir prepare-commit-msg kancası ya da `core.hooksPath` (husky vb.)
 *   varsa hiçbir şeye dokunulmaz; eklenti mesaj kutusu yöntemine düşer.
 */

export const HOOK_MARKER = 'tulvez-code-coauthor';
const LIST_NAME = 'tulvez-ai-edits';
const HOOK_NAME = 'prepare-commit-msg';

export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; code: number }>;

export const gitRun: GitRun = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve({ stdout: String(stdout ?? ''), code: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
    });
  });

/** Kancanın içeriği. POSIX sh: Git for Windows da kancaları kendi sh'ıyla çalıştırır. */
export function hookScript(trailer = CO_AUTHOR_TRAILER): string {
  const name = trailer.replace(/^Co-authored-by:\s*/i, '').split('<')[0].trim();
  return [
    '#!/bin/sh',
    `# ${HOOK_MARKER}`,
    '# Tulvez Code ek katkıcı kancası: Tulvez Code\'un değiştirdiği bir dosya commit\'e',
    `# giriyorsa mesaja "${trailer}" satırını ekler (Copilot'un yaptığı gibi).`,
    '# Tulvez Code kurdu; silmek güvenlidir. Commit\'i hiçbir durumda durdurmaz.',
    'case "$2" in merge|squash) exit 0 ;; esac',
    `list=$(git rev-parse --git-path ${LIST_NAME} 2>/dev/null) || exit 0`,
    '[ -s "$list" ] || exit 0',
    '# 30 günden eski liste: eklenti kaldırılmış olabilir, yok sayılır',
    '[ -n "$(find "$list" -mtime -30 2>/dev/null)" ] || exit 0',
    '# commit\'i Tulvez Code kendisi atıyorsa yazar zaten odur, ek katkıcı eklenmez',
    `git var GIT_AUTHOR_IDENT 2>/dev/null | grep -qF '<${BOT_EMAIL}>' && exit 0`,
    `grep -qF 'Co-authored-by: ${name} <' "$1" 2>/dev/null && exit 0`,
    'git -c core.quotePath=false diff --cached --name-only 2>/dev/null | grep -qxF -f "$list" || exit 0',
    `git interpret-trailers --in-place --trailer '${trailer}' "$1" 2>/dev/null || true`,
    'exit 0',
    '',
  ].join('\n');
}

export interface RepoPaths {
  root: string;
  listFile: string;
  /** null: depo kendi kanca klasörünü kullanıyor (core.hooksPath), kancaya dokunulmaz */
  hookFile: string | null;
}

/** Dosyanın bulunduğu git deposunun kökü; depo değilse null. */
export async function repoRootOf(filePath: string, run: GitRun = gitRun): Promise<string | null> {
  let dir = filePath;
  try { if (!(await fs.stat(filePath)).isDirectory()) dir = path.dirname(filePath); } catch { dir = path.dirname(filePath); }
  const res = await run(['rev-parse', '--show-toplevel'], dir);
  const top = res.stdout.split(/\r?\n/)[0].trim();
  return res.code === 0 && top ? path.resolve(top) : null;
}

export async function repoPaths(root: string, run: GitRun = gitRun): Promise<RepoPaths | null> {
  const list = await run(['rev-parse', '--git-path', LIST_NAME], root);
  if (list.code !== 0 || !list.stdout.trim()) return null;
  const hooksPathCfg = await run(['config', '--get', 'core.hooksPath'], root);
  let hookFile: string | null = null;
  if (!hooksPathCfg.stdout.trim()) {
    const hooks = await run(['rev-parse', '--git-path', 'hooks'], root);
    if (hooks.code === 0 && hooks.stdout.trim()) hookFile = path.resolve(root, hooks.stdout.trim(), HOOK_NAME);
  }
  return { root, listFile: path.resolve(root, list.stdout.trim()), hookFile };
}

/**
 * Kancayı kurar ya da günceller. Yerinde başka bir kanca varsa dokunmaz.
 * Dönen değer: kanca bizimse true (commit anında ekleme çalışır).
 */
export async function installHook(paths: RepoPaths): Promise<boolean> {
  if (!paths.hookFile) return false;
  const script = hookScript();
  try {
    const current = await fs.readFile(paths.hookFile, 'utf8');
    if (!current.includes(HOOK_MARKER)) return false; // kullanıcının kendi kancası
    if (current === script) return true;
  } catch { /* yok: kurulacak */ }
  try {
    await fs.mkdir(path.dirname(paths.hookFile), { recursive: true });
    await fs.writeFile(paths.hookFile, script, { encoding: 'utf8', mode: 0o755 });
    await fs.chmod(paths.hookFile, 0o755).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Ayar kapatılınca: yalnız bizim kancamızı ve listeyi siler. */
export async function removeHook(paths: RepoPaths): Promise<void> {
  if (paths.hookFile) {
    try {
      const current = await fs.readFile(paths.hookFile, 'utf8');
      if (current.includes(HOOK_MARKER)) await fs.unlink(paths.hookFile);
    } catch { /* yok */ }
  }
  await fs.unlink(paths.listFile).catch(() => undefined);
}

/** Depo köküne göre, `/` ayraçlı göreli yol (git'in staged listesiyle aynı biçim). */
export function relPath(root: string, filePath: string): string | null {
  const rel = path.relative(root, path.resolve(filePath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export async function readList(listFile: string): Promise<Set<string>> {
  try {
    const text = await fs.readFile(listFile, 'utf8');
    return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function writeList(listFile: string, items: Set<string>): Promise<void> {
  if (items.size === 0) {
    await fs.unlink(listFile).catch(() => undefined);
    return;
  }
  await fs.writeFile(listFile, `${[...items].sort().join('\n')}\n`, 'utf8');
}

/** Tulvez Code'un yazdığı dosyayı listeye ekler. */
export async function addToList(paths: RepoPaths, filePath: string): Promise<boolean> {
  const rel = relPath(paths.root, filePath);
  if (!rel) return false;
  const items = await readList(paths.listFile);
  if (items.has(rel)) {
    // Varsa da tarihi tazelenir: kanca 30 günden eski listeyi yok sayar
    await writeList(paths.listFile, items);
    return false;
  }
  items.add(rel);
  await writeList(paths.listFile, items);
  return true;
}

/** Commit'lenmemiş değişikliği olan dosyalar (staged, staged olmayan, izlenmeyen). */
export async function changedFiles(root: string, run: GitRun = gitRun): Promise<Set<string> | null> {
  const res = await run(['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], root);
  if (res.code !== 0) return null;
  const out = new Set<string>();
  const parts = res.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    out.add(entry.slice(3));
    // yeniden adlandırmada sonraki parça eski ad
    if (entry[0] === 'R' || entry[0] === 'C') i++;
  }
  return out;
}

/** Son commit'teki dosyalar. */
export async function filesInHead(root: string, run: GitRun = gitRun): Promise<Set<string>> {
  const res = await run(['-c', 'core.quotePath=false', 'show', '--name-only', '--format=', '-z', 'HEAD'], root);
  return new Set(res.code === 0 ? res.stdout.split('\0').map((s) => s.trim()).filter(Boolean) : []);
}

/**
 * Listeyi temizler (Copilot'ta commit ve "değişiklikleri at" sonrası iz silinir):
 * - commit'lenmemiş değişikliği kalmayan dosyalar (commit'lendi ya da geri alındı),
 * - yeni bir commit'e girmiş dosyalar (`committed`), yeniden değiştirilse bile.
 * Değişen bir şey olduysa true.
 */
export async function pruneList(paths: RepoPaths, committed: Set<string> = new Set(), run: GitRun = gitRun): Promise<boolean> {
  const items = await readList(paths.listFile);
  if (items.size === 0) return false;
  const changed = await changedFiles(paths.root, run);
  if (!changed) return false;
  let dirty = false;
  for (const rel of [...items]) {
    if (!changed.has(rel) || committed.has(rel)) { items.delete(rel); dirty = true; }
  }
  if (dirty) await writeList(paths.listFile, items);
  return dirty;
}

/** Bu dosyalar commit'e girerse ek katkıcı eklenmeli mi? (mesaj kutusu yöntemi için) */
export async function listIntersects(paths: RepoPaths, files: Iterable<string>): Promise<boolean> {
  const items = await readList(paths.listFile);
  if (items.size === 0) return false;
  for (const f of files) if (items.has(f)) return true;
  return false;
}
