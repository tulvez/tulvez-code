import { vi } from 'vitest';
import { createVscodeStub } from './vsmock';

const state = { root: process.cwd() };

vi.mock('vscode', () => {
  const stub = createVscodeStub(state.root);
  (globalThis as { __vscodeStub?: unknown }).__vscodeStub = stub;
  return stub;
});

export function setWorkspaceRoot(root: string): void {
  state.root = root;
  const stub = (globalThis as { __vscodeStub?: { workspace: { workspaceFolders: unknown } } }).__vscodeStub;
  if (stub) {
    stub.workspace.workspaceFolders = [{ uri: { fsPath: root, path: root, scheme: 'file' } }];
  }
}