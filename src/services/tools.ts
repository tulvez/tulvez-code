import * as cp from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  requiresApproval: boolean;
  readOnly: boolean;
}



export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Çalışma alanındaki bir dosyanın içeriğini satır numaralarıyla okur.',
    requiresApproval: false,
    readOnly: true,
    schema: z.object({ path: z.string().describe('Dosya yolu (çalışma alanına göre)') }),
  },
  {
    name: 'read_files',
    description: 'Birden fazla dosyayı aynı anda okur (bağlam için verimli).',
    requiresApproval: false,
    readOnly: true,
    schema: z.object({ paths: z.array(z.string()).describe('Dosya yolları') }),
  },
  {
    name: 'grep_files',
    description: 'Çalışma alanında regex ile arama yapar; dosya:satır eşleşmeleri döner.',
    requiresApproval: false,
    readOnly: true,
    schema: z.object({
      pattern: z.string().describe('Regex deseni'),
      include: z.string().optional().describe('Dosya uzantısı filtresi (örn: ts)'),
      max_results: z.number().optional().describe('En fazla sonuç sayısı (varsayılan 100)'),
    }),
  },
  {
    name: 'list_dir',
    description: 'Bir klasörün ağacını (derinlik sınırlı) listeler.',
    requiresApproval: false,
    readOnly: true,
    schema: z.object({
      directory: z.string().optional().describe('Klasör yolu'),
      depth: z.number().optional().describe('Derinlik (varsayılan 2)'),
    }),
  },
  {
    name: 'list_files',
    description: 'Bir klasördeki dosyaları tek seviye listeler.',
    requiresApproval: false,
    readOnly: true,
    schema: z.object({ directory: z.string().optional().describe('Klasör yolu (varsayılan: kök)') }),
  },
  {
    name: 'write_file',
    description: 'Bir dosyaya içerik yazar (yoksa oluşturur).',
    requiresApproval: false,
    readOnly: false,
    schema: z.object({
      path: z.string().describe('Dosya yolu'),
      content: z.string().describe('Yazılacak içerik'),
    }),
  },
  {
    name: 'replace_in_file',
    description: 'Bir dosyada metni değiştirir; eski metin tam ve tekil eşleşmek zorundadır, aksi halde hata döner.',
    requiresApproval: false,
    readOnly: false,
    schema: z.object({
      path: z.string().describe('Dosya yolu'),
      old_string: z.string().describe('Değiştirilecek mevcut metin (tam ve tekil olmalı)'),
      new_string: z.string().describe('Yeni metin'),
    }),
  },
  {
    name: 'run_command',
    description: 'Çalışma alanında terminal komutu çalıştırır. Uzun süreli komutlar (sunucu, GUI) otomatik sonlandırılır.',
    requiresApproval: true,
    readOnly: false,
    schema: z.object({ command: z.string().describe('Çalıştırılacak komut') }),
  },
  {
    name: 'run_in_background',
    description: 'Uzun süreli çalışacak bir komutu arka planda başlatır (sunucu, GUI). Hemen döner, süreç arka planda çalışır.',
    requiresApproval: true,
    readOnly: false,
    schema: z.object({
      command: z.string().describe('Çalıştırılacak komut'),
      logFile: z.string().optional().describe('Çıktının yazılacağı dosya yolu'),
    }),
  },
  {
    name: 'stop_background',
    description: 'Arka planda çalışan bir süreci sonlandırır.',
    requiresApproval: true,
    readOnly: false,
    schema: z.object({ command: z.string().optional().describe('Durdurulacak komut parçası') }),
  },
];
/** Arka planda başlatılan süreçler (pid → komut). */
const backgroundProcesses = new Map<number, string>();

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

function resolvePath(p: string): string {
  const root = workspaceRoot();
  return path.isAbsolute(p) ? p : path.join(root, p);
}

const aiEdits = new Map<string, { start: number; end: number }[]>();

let aiDecorationType: vscode.TextEditorDecorationType | null = null;
const AI_DECORATION_COLOR = 'rgba(63,185,80,0.10)';

export function refreshAiDecorations(): void {
  if (!aiDecorationType) {
    aiDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: AI_DECORATION_COLOR,
      overviewRulerColor: '#3fb950',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }
  const enabled = vscode.workspace.getConfiguration('tulvez').get<boolean>('showAiEdits', true);
  for (const editor of vscode.window.visibleTextEditors) {
    const ranges = enabled ? aiEdits.get(editor.document.uri.fsPath) : undefined;
    if (!ranges) {
      editor.setDecorations(aiDecorationType, []);
      continue;
    }
    editor.setDecorations(
      aiDecorationType,
      ranges.map((r) => new vscode.Range(r.start, 0, r.end, 0)),
    );
  }
}

export function aiLineCountForActiveEditor(): number | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const ranges = aiEdits.get(editor.document.uri.fsPath);
  if (!ranges || ranges.length === 0) return null;
  return ranges.reduce((a, r) => a + (r.end - r.start + 1), 0);
}

/** Düzenleme araçları için hedef dosyanın mutlak yolunu verir. */
export function resolveEditPath(p: string): string | null {
  if (!p) return null;
  return resolvePath(p);
}

export const aiEditHooks: { onEdit?: () => void } = {};

/** Yazma öncesi içerik: diff önizlemesi için tutulur. */
const preEditSnapshot = new Map<string, string>();

/** Diff'in sol tarafında "önceki hali"ni göstermek için içerik sağlayıcı. */
interface DiffProvider {
  provideTextDocumentContent(uri: vscode.Uri): string;
}
let diffProvider: DiffProvider | null = null;

export function getDiffContentProvider(): DiffProvider {
  if (!diffProvider) {
    diffProvider = {
      provideTextDocumentContent: (uri: vscode.Uri): string =>
        preEditSnapshot.get(decodeURIComponent(uri.path.replace(/^\//, ''))) ?? '',
    };
  }
  return diffProvider;
}

export async function snapshotBeforeEdit(fsPath: string): Promise<void> {
  try {
    preEditSnapshot.set(fsPath, await fs.readFile(fsPath, 'utf8'));
  } catch {
    preEditSnapshot.delete(fsPath);
  }
}

export function clearSnapshot(fsPath: string): void {
  preEditSnapshot.delete(fsPath);
}

function markAiEdit(filePath: string, start: number, end: number): void {
  const ranges = aiEdits.get(filePath) ?? [];
  ranges.push({ start, end });
  aiEdits.set(filePath, ranges);
  refreshAiDecorations();
  aiEditHooks.onEdit?.();
}

const MAX_READ_CHARS = 50000;
const MAX_OUTPUT_CHARS = 30000;
/** Çıktı üretmeyen bir komut (GUI, sunucu) bu süreden sonra sonlandırılır. */
const MAX_IDLE_SECONDS = 45;
/** Bir komut en fazla bu kadar süreyle çalışabilir. */
const MAX_RUN_SECONDS = 180;

/**
 * Bir dosyanın çıktısını token bütçesine göre kırparken, satır ortasında
 * kesmek yerine ilk yarı + son yarı gösterir; model bağlamı görmeye devam eder.
 */
function truncateForBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = Math.floor(budget * 0.6);
  const tail = budget - head - 40;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n...[${omitted} karakter atlandı. Devamı için grep_files veya satır aralığı oku]...\n\n${text.slice(-tail)}`;
}

function withLineNumbers(content: string): string {
  const numbered = content
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4, ' ')}| ${line}`)
    .join('\n');
  return numbered.length > MAX_READ_CHARS
    ? `${numbered.slice(0, MAX_READ_CHARS)}\n...(kısaltıldı)`
    : numbered;
}

function firstLines(text: string): string {
  return text.split('\n').slice(0, 3).map((l) => `  ${l.trim().slice(0, 100)}`).join('\n');
}

/** Bir dosya dışarıdan değiştiyse (agent yazdıysa) VS Code'un diff görünümünü açar. */
export async function openDiffForFile(fsPath: string, title = 'Tulvez değişikliği'): Promise<void> {
  try {
    const before = preEditSnapshot.get(fsPath);
    const uri = vscode.Uri.file(fsPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const after = doc.getText();
    preEditSnapshot.delete(fsPath);

    if (before === undefined || before === after) {
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    }

    // Sol tarafı gerçek eski içerikle doldur, sağ taraf yeni hali olsun
    preEditSnapshot.set(fsPath, before);
    const left = vscode.Uri.parse(`tulvez-before:${encodeURIComponent(fsPath)}`);
    vscode.workspace.registerTextDocumentContentProvider('tulvez-before', getDiffContentProvider());
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      uri,
      `${title}: ${path.basename(fsPath)}`,
      { preview: false },
    );
    const opened = preEditSnapshot.get(fsPath);
    preEditSnapshot.delete(fsPath);
    if (opened !== undefined) {
      setTimeout(() => {
        preEditSnapshot.set(fsPath, opened);
      }, 1500);
    }
  } catch {
    // diff açılamazsa akış bozulmasın
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  allowShell: boolean,
  budgetChars = 24000,
): Promise<string> {
  try {
    switch (name) {
      case 'read_file': {
        const content = await fs.readFile(resolvePath(String(args.path ?? '')), 'utf8');
        return withLineNumbers(content);
      }
      case 'read_files': {
        const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
        const out: string[] = [];
        for (const p of paths.slice(0, 10)) {
          try {
            const content = await fs.readFile(resolvePath(p), 'utf8');
            out.push(`=== ${p} ===\n${withLineNumbers(content)}`);
          } catch {
            out.push(`=== ${p} ===\n(okunamadı)`);
          }
        }
        return out.join('\n\n') || 'Dosya verilmedi.';
      }
      case 'grep_files': {
        const pattern = String(args.pattern ?? '');
        const include = String(args.include ?? '');
        const max = Number(args.max_results ?? 100);
        if (!pattern) return 'Hata: pattern boş.';
        let re: RegExp;
        try {
          re = new RegExp(pattern, 'i');
        } catch (err) {
          return `Hata: geçersiz regex (${err instanceof Error ? err.message : String(err)})`;
        }
        const hits: string[] = [];
        const root = workspaceRoot();
        const skip = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage']);
        const walk = async (dir: string): Promise<void> => {
          if (hits.length >= max) return;
          let entries: import('fs').Dirent[];
          try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (hits.length >= max) return;
            if (skip.has(e.name) || e.name.startsWith('.')) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { await walk(full); continue; }
            if (include && !e.name.toLowerCase().endsWith(include.toLowerCase())) continue;
            let content: string;
            try {
              if ((await fs.stat(full)).size > 400000) continue;
              content = await fs.readFile(full, 'utf8');
            } catch { continue; }
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && hits.length < max; i++) {
              if (re.test(lines[i])) {
                hits.push(`${path.relative(root, full).replace(/\\/g, '/')}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
              }
            }
          }
        };
        await walk(root || '.');
        return hits.length ? hits.join('\n') : 'Eşleşme bulunamadı.';
      }
      case 'list_dir': {
        const dir = resolvePath(String(args.directory ?? '.'));
        const depth = Math.min(4, Math.max(1, Number(args.depth ?? 2)));
        const skipDirs = new Set(['node_modules', '.git', 'dist', 'out', 'build']);
        const out: string[] = [];
        const walk = async (current: string, level: number, prefix: string): Promise<void> => {
          if (level > depth) return;
          let entries: import('fs').Dirent[];
          try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
          const sorted = entries
            .filter((e) => !skipDirs.has(e.name) && !e.name.startsWith('.'))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
          for (const e of sorted) {
            out.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`);
            if (e.isDirectory()) await walk(path.join(current, e.name), level + 1, `${prefix}  `);
          }
        };
        await walk(dir, 1, '');
        return out.join('\n') || '(boş)';
      }
      case 'replace_in_file': {
        const target = resolvePath(String(args.path ?? ''));
        const content = await fs.readFile(target, 'utf8');
        const oldStr = String(args.old_string ?? '');
        const newStr = String(args.new_string ?? '');
        if (!oldStr) return 'Hata: old_string boş.';
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
          return `Hata: eski metin bulunamadı. ${path.basename(target)} içinde şu satırları kontrol et:\n${firstLines(oldStr)}`;
        }
        if (occurrences > 1) {
          const lines = content.split('\n');
          const numbers = lines
            .map((l, i) => (l.includes(oldStr.split('\n')[0]) ? i + 1 : 0))
            .filter(Boolean);
          return `Hata: eski metin ${occurrences} yerde geçiyor (satırlar: ${numbers.slice(0, 8).join(', ')}). Daha fazla bağlam ekleyerek tekilleştir.`;
        }
        const updated = content.replace(oldStr, newStr);
        await fs.writeFile(target, updated, 'utf8');
        const idx = updated.indexOf(newStr);
        if (idx >= 0) {
          const startLine = updated.slice(0, idx).split('\n').length - 1;
          const span = newStr.split('\n').length;
          markAiEdit(target, startLine, Math.max(startLine, startLine + span - 1));
        }
        return `Düzenlendi: ${path.relative(workspaceRoot() || '.', target).replace(/\\/g, '/')}`;
      }
      case 'write_file': {
        const target = resolvePath(String(args.path ?? ''));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, String(args.content ?? ''), 'utf8');
        const lines = String(args.content ?? '').split('\n').length;
        markAiEdit(target, 0, Math.max(0, lines - 1));
        return `Yazıldı: ${target}`;
      }
      case 'replace_in_file': {
        const target = resolvePath(String(args.path ?? ''));
        const content = await fs.readFile(target, 'utf8');
        const oldStr = String(args.old_string ?? '');
        const newStr = String(args.new_string ?? '');
        if (!oldStr) return 'Hata: old_string boş.';
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
          return `Hata: eski metin bulunamadı. Şu satırları kontrol et:\n${firstLines(oldStr)}`;
        }
        if (occurrences > 1) {
          const lines = content.split('\n');
          const numbers = lines
            .map((l, i) => (l.includes(oldStr.split('\n')[0]) ? i + 1 : 0))
            .filter(Boolean);
          return `Hata: eski metin ${occurrences} yerde geçiyor (satırlar: ${numbers.slice(0, 8).join(', ')}). Daha fazla bağlam ekleyerek tekilleştir.`;
        }
        const updated = content.replace(oldStr, newStr);
        await fs.writeFile(target, updated, 'utf8');
        const idx = updated.indexOf(newStr);
        if (idx >= 0) {
          const startLine = updated.slice(0, idx).split('\n').length - 1;
          const span = newStr.split('\n').length;
          markAiEdit(target, startLine, Math.max(startLine, startLine + span - 1));
        }
        return `Düzenlendi: ${path.relative(workspaceRoot() || '.', target).replace(/\\/g, '/')}`;
      }
      case 'list_files': {
        const dir = resolvePath(String(args.directory ?? '.'));
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries
          .filter((e) => e.name !== 'node_modules' && e.name !== '.git')
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .join('\n');
      }
      case 'run_command': {
        if (!allowShell) return 'Hata: Terminal komutları kapalı. Ayarlar\'dan açın.';
        const cwd = workspaceRoot() || undefined;
        return await new Promise<string>((resolve) => {
          const child = cp.spawn('cmd.exe', ['/d', '/s', '/c', String(args.command ?? '')], {
            cwd,
            windowsHide: true,
          });

          let stdout = '';
          let stderr = '';
          let finished = false;

          const collect = (): void => {
            if (finished) return;
            finished = true;
            clearInterval(ticker);
            clearTimeout(hardStop);
            const out = `${stdout}\n${stderr}`.trim();
            resolve(out || (code === 0 ? '(çıktı yok)' : `exit ${code}`));
          };

          let code = 0;
          child.stdout?.on('data', (d) => {
            stdout += String(d);
            if (stdout.length > MAX_OUTPUT_CHARS) {
              stdout = stdout.slice(0, MAX_OUTPUT_CHARS) + '\n...(çıktı kısaltıldı)';
              stopProcess();
            }
          });
          child.stderr?.on('data', (d) => { stderr += String(d); });
          child.on('error', (err) => { stderr += String(err.message); collect(); });
          child.on('close', (exitCode) => { code = exitCode ?? 0; collect(); });

          // Uzun süreçler (sunucu, GUI) sonsuza kadar çalışır; çıktı üretmeyenleri
          // 45 saniye sonra sonlandırıp modele "arka planda çalışıyor" bilgisini ver.
          let idleTicks = 0;
          const ticker = setInterval(() => {
            if (stdout.length || stderr.length) idleTicks = 0;
            else idleTicks++;
            if (idleTicks * 5 >= MAX_IDLE_SECONDS) {
              stopProcess();
              stdout += `\n(komut ${MAX_IDLE_SECONDS} saniye çıktı üretmediği için sonlandırıldı; arka planda çalışıyorsa ayrı terminalden kontrol edebilirsin)`;
              collect();
            }
          }, 5000);

          const hardStop = setTimeout(() => { stopProcess(); collect(); }, MAX_RUN_SECONDS * 1000);

          function stopProcess(): void {
            if (child.killed) return;
            try {
              // Windows'ta alt süreçleri de öldür (cmd -> python -> tkinter)
              cp.execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
            } catch {
              try { child.kill('SIGKILL'); } catch { /* yoksay */ }
            }
          }
        });
      }
      case 'run_in_background': {
        if (!allowShell) return 'Hata: Terminal komutları kapalı. Ayarlar\'dan açın.';
        const cwd = workspaceRoot() || undefined;
        const logFile = args.logFile
          ? resolvePath(String(args.logFile))
          : path.join(cwd ?? '.', 'tulvez-bg.log');
        const out = fsSync.openSync(logFile, 'a');
        const child = cp.spawn('cmd.exe', ['/d', '/s', '/c', String(args.command ?? '')], {
          cwd,
          detached: true,
          stdio: ['ignore', out, out],
          windowsHide: true,
        });
        child.unref();
        fsSync.closeSync(out);
        backgroundProcesses.set(child.pid ?? 0, String(args.command ?? ''));
        return `Arka planda başlatıldı (pid ${child.pid ?? '?'}). Çıktı: ${logFile}\nDurdurmak için: stop_background`;
      }
      case 'stop_background': {
        const wanted = String(args.command ?? '').toLowerCase();
        let stopped = 0;
        for (const pid of backgroundProcesses.keys()) {
          try {
            cp.execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
            stopped++;
          } catch { /* zaten kapanmış */ }
          backgroundProcesses.delete(pid);
        }
        return stopped ? `${stopped} arka plan süreci sonlandırıldı${wanted ? ` (${wanted})` : ''}` : 'Arka planda çalışan süreç yok.';
      }
      default:
        return `Bilinmeyen araç: ${name}`;
    }
  } catch (err) {
    return `Araç hatası (${name}): ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Her araç çıktısını token bütçesine sığdırır. */
export function applyBudget(result: string, budgetChars = 24000): string {
  if (result.length <= budgetChars) return result;
  return `${truncateForBudget(result, budgetChars)}\n\n_(toplam ${result.length} karakter, ${budgetChars} karaktere kısaltıldı)_`;
}

