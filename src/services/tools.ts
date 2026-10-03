import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  readOnly: boolean;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Çalışma alanındaki bir dosyanın içeriğini okur.',
    requiresApproval: false,
    readOnly: true,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Dosya yolu (çalışma alanına göre)' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Bir dosyaya içerik yazar (yoksa oluşturur).',
    requiresApproval: false,
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dosya yolu' },
        content: { type: 'string', description: 'Yazılacak içerik' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Bir dosyada eski metni yenisiyle değiştirir.',
    requiresApproval: false,
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dosya yolu' },
        old_string: { type: 'string', description: 'Değiştirilecek mevcut metin' },
        new_string: { type: 'string', description: 'Yeni metin' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_files',
    description: 'Bir klasördeki dosyaları listeler.',
    requiresApproval: false,
    readOnly: true,
    parameters: {
      type: 'object',
      properties: { directory: { type: 'string', description: 'Klasör yolu (varsayılan: kök)' } },
    },
  },
  {
    name: 'run_command',
    description: 'Çalışma alanında terminal komutu çalıştırır.',
    requiresApproval: true,
    readOnly: false,
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Çalıştırılacak komut' } },
      required: ['command'],
    },
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

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  allowShell: boolean,
): Promise<string> {
  try {
    switch (name) {
      case 'read_file': {
        const content = await fs.readFile(resolvePath(String(args.path ?? '')), 'utf8');
        return content.length > 50000 ? content.slice(0, 50000) + '\n...(kısaltıldı)' : content;
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
