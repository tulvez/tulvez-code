import * as cp from 'child_process';
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
    name: 'edit_file',
    description: 'Bir dosyada eski metni yenisiyle değiştirir.',
    requiresApproval: false,
    readOnly: false,
    schema: z.object({
      path: z.string().describe('Dosya yolu'),
      old_string: z.string().describe('Değiştirilecek mevcut metin'),
      new_string: z.string().describe('Yeni metin'),
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
    description: 'Çalışma alanında terminal komutu çalıştırır.',
    requiresApproval: true,
    readOnly: false,
    schema: z.object({ command: z.string().describe('Çalıştırılacak komut') }),
  },
];
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

export const aiEditHooks: { onEdit?: () => void } = {};

function markAiEdit(filePath: string, start: number, end: number): void {
  const ranges = aiEdits.get(filePath) ?? [];
  ranges.push({ start, end });
  aiEdits.set(filePath, ranges);
  refreshAiDecorations();
  aiEditHooks.onEdit?.();
}

const MAX_READ_CHARS = 50000;

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

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  allowShell: boolean,
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
      case 'edit_file': {
        const target = resolvePath(String(args.path ?? ''));
        const content = await fs.readFile(target, 'utf8');
        const oldStr = String(args.old_string ?? '');
        if (!content.includes(oldStr)) return 'Hata: old_string dosyada bulunamadı.';
        const newStr = String(args.new_string ?? '');
        const updated = content.replace(oldStr, newStr);
        await fs.writeFile(target, updated, 'utf8');
        const idx = updated.indexOf(newStr);
        if (idx >= 0) {
          const startLine = updated.slice(0, idx).split('\n').length - 1;
          const span = newStr.split('\n').length;
          markAiEdit(target, startLine, Math.max(startLine, startLine + span - 1));
        }
        return `Düzenlendi: ${target}`;
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
          cp.exec(String(args.command ?? ''), { cwd }, (err, stdout, stderr) => {
            const out = `${stdout}\n${stderr}`.trim();
            resolve(err ? `exit ${err.code ?? 1}\n${out || err.message}` : out || '(çıktı yok)');
          });
        });
      }
      default:
        return `Bilinmeyen araç: ${name}`;
    }
  } catch (err) {
    return `Araç hatası (${name}): ${err instanceof Error ? err.message : String(err)}`;
  }
}

