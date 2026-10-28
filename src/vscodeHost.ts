import * as vscode from 'vscode';
import type { Host } from './services/host';
import { markAiEdit } from './editorUi';

/** Eklentideki ortam: ilk çalışma alanı klasörü ve `tulvez.*` VS Code ayarları. */
export const vscodeHost: Host = {
  surface: 'vscode',
  workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  setting: <T>(key: string, fallback: T): T => vscode.workspace.getConfiguration('tulvez').get<T>(key, fallback),
  onAiEdit: markAiEdit,
  uiLanguage: () => vscode.env?.language,
};
