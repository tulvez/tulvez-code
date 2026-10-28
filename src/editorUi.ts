import * as path from 'path';
import * as vscode from 'vscode';
import { preEditSnapshot } from './services/tools';

// Ajanın yazdığı satırların editördeki işaretleri ve diff görünümü; yalnız eklentide vardır.

const aiEdits = new Map<string, { start: number; end: number }[]>();

let aiDecorationType: vscode.TextEditorDecorationType | null = null;
const AI_DECORATION_COLOR = 'rgba(63,185,80,0.10)';

export const aiEditHooks: { onEdit?: (filePath: string) => void } = {};

export function markAiEdit(filePath: string, start: number, end: number): void {
  const ranges = aiEdits.get(filePath) ?? [];
  ranges.push({ start, end });
  aiEdits.set(filePath, ranges);
  refreshAiDecorations();
  aiEditHooks.onEdit?.(filePath);
}

/** Geri alınan dosyanın "Tulvez yazdı" işaretleri kaldırılır. */
export function forgetAiEdits(fsPath: string): void {
  aiEdits.delete(fsPath);
  refreshAiDecorations();
}

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
