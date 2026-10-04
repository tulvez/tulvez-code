import { vi } from 'vitest';
import type { TulvezSettings } from '../services/messages';

/** Testlerde `vscode` modülünü taklit eder (gerçek API sadece extension host'ta vardır). */
export function createVscodeStub(workspaceRoot: string): Record<string, unknown> {
  return {
    OverviewRulerLane: { Right: 2, Left: 1, Center: 3, Full: 4 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    Range: class {
      constructor(
        public startLine: number,
        public startChar: number,
        public endLine: number,
        public endChar: number,
      ) {}
    },
    Uri: {
      file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }),
      joinPath: (base: { fsPath: string; path: string }, ...parts: string[]) => ({
        fsPath: [base.fsPath, ...parts].join('/').replace(/\\/g, '/'),
        path: [base.path, ...parts].join('/'),
        scheme: 'file',
      }),
    },
    window: {
      createTextEditorDecorationType: () => ({}),
      visibleTextEditors: [] as unknown[],
      activeTextEditor: null,
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: workspaceRoot, path: workspaceRoot, scheme: 'file' } }],
      getConfiguration: () => ({ get: (_k: string, d?: unknown) => d, update: vi.fn() }),
    },
  };
}

export function setWorkspaceRoot(root: string): void {
  const stub = (globalThis as { __vscodeStub?: { workspace: { workspaceFolders: unknown } } }).__vscodeStub;
  if (stub) {
    stub.workspace.workspaceFolders = [{ uri: { fsPath: root, path: root, scheme: 'file' } }];
  }
}

export const baseSettings = {
  aiProvider: 'gemini' as TulvezSettings['aiProvider'],
  model: 'gemini-2.5-flash',
  apiKey: 'test-key',
  ollamaUrl: 'http://localhost:11434',
  baseUrl: '',
  autoApproveCommands: false,
  allowShellCommands: false,
  telemetry: false,
  sendCodeContext: false,
  showAiEdits: true,
  showModels: false,
  showThinking: true,
};