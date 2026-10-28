import { vi } from 'vitest';
import { createVscodeStub } from './vsmock';
import { setHost } from '../services/host';

const state = { root: process.cwd() };

vi.mock('vscode', () => {
  const stub = createVscodeStub(state.root);
  (globalThis as { __vscodeStub?: unknown }).__vscodeStub = stub;
  return stub;
});

// Testler eklentideki ortamla çalışır: çekirdek vscode taklidinden (çalışma alanı, ayarlar) okur.
// Dinamik içe aktarma: `vscode` taklidi kurulmadan modül çözülmesin (testlerin kendi deseni).
// Webview testleri (jsdom) eklenti koduna dokunmaz; orada `vscode` taklidi çözülmez.
if (!('window' in globalThis)) {
  const { vscodeHost } = await import('../vscodeHost');
  setHost(vscodeHost);
}

export function setWorkspaceRoot(root: string): void {
  state.root = root;
  const stub = (globalThis as { __vscodeStub?: { workspace: { workspaceFolders: unknown } } }).__vscodeStub;
  if (stub) {
    stub.workspace.workspaceFolders = [{ uri: { fsPath: root, path: root, scheme: 'file' } }];
  }
}