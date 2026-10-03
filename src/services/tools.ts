import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Çalışma alanındaki bir dosyanın içeriğini okur.',
    requiresApproval: false,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Dosya yolu (çalışma alanına göre)' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Bir dosyaya içerik yazar (yoksa oluşturur).',
    requiresApproval: true,
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
    requiresApproval: true,
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
    parameters: {
      type: 'object',
      properties: { directory: { type: 'string', description: 'Klasör yolu (varsayılan: kök)' } },
    },
  },
  {
    name: 'run_command',
    description: 'Çalışma alanında terminal komutu çalıştırır.',
    requiresApproval: true,
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
        return `Yazıldı: ${target}`;
      }
      case 'edit_file': {
        const target = resolvePath(String(args.path ?? ''));
        const content = await fs.readFile(target, 'utf8');
        const oldStr = String(args.old_string ?? '');
        if (!content.includes(oldStr)) return 'Hata: old_string dosyada bulunamadı.';
        await fs.writeFile(target, content.replace(oldStr, String(args.new_string ?? '')), 'utf8');
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
