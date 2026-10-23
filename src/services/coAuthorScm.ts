import * as vscode from 'vscode';
import { CO_AUTHOR_TRAILER, appendTrailer, hasCoAuthor } from './gitIdentity';

/**
 * Copilot gibi ek katkıcı: kullanıcı commit'i VS Code'un Kaynak Denetimi
 * panelinden kendisi atsa bile, commit'e Tulvez Code'un düzenlediği bir dosya
 * giriyorsa mesaj kutusuna `Co-authored-by: Tulvez Code …` satırı eklenir.
 *
 * - Yazar her zaman kullanıcıdır; yalnızca mesaj kutusuna tek satır eklenir.
 * - Tulvez'in düzenlediği dosyalardaki değişiklik geri alınırsa satır kaldırılır.
 * - Commit atılıp o dosyalar temizlenince takip biter.
 * - `tulvez.gitCoAuthor` kapalıysa hiçbir şey yapılmaz.
 */

// VS Code yerleşik git eklentisinin (vscode.git) kullandığımız kadarı
interface GitChange { uri: vscode.Uri }
interface GitRepositoryState {
  indexChanges: GitChange[];
  workingTreeChanges: GitChange[];
  untrackedChanges?: GitChange[];
  onDidChange: vscode.Event<void>;
}
interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
  state: GitRepositoryState;
}
interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}
interface GitExtension {
  getAPI(version: 1): GitAPI;
}

const norm = (p: string): string => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
};

/** Tulvez Code'un düzenlediği, henüz commit'lenmemiş dosyalar */
const aiTouched = new Set<string>();
let api: GitAPI | null = null;

function enabled(): boolean {
  return vscode.workspace.getConfiguration('tulvez').get<boolean>('gitCoAuthor', true);
}

/** Satırı mesaj kutusuna ekler: boşsa kullanıcının yazacağı yer için üstte iki boş satır bırakılır. */
export function addTrailerToInput(value: string): string {
  if (hasCoAuthor(value)) return value;
  const body = value.replace(/\s+$/, '');
  return body ? appendTrailer(body) : `\n\n${CO_AUTHOR_TRAILER}`;
}

/** Satırı mesaj kutusundan çıkarır (Tulvez'in değişiklikleri geri alındığında). */
export function removeTrailerFromInput(value: string): string {
  if (!hasCoAuthor(value)) return value;
  return value
    .split(/\r?\n/)
    .filter((line) => !hasCoAuthor(line))
    .join('\n')
    .replace(/\s+$/, '');
}

function sync(repo: GitRepository): void {
  const root = norm(repo.rootUri.fsPath);
  const changed = new Set(
    [...repo.state.indexChanges, ...repo.state.workingTreeChanges, ...(repo.state.untrackedChanges ?? [])]
      .map((c) => norm(c.uri.fsPath)),
  );

  // Bu depoya ait, artık değişiklik listesinde olmayan dosyalar commit'lendi ya da geri alındı
  let pending = false;
  for (const file of [...aiTouched]) {
    if (!file.startsWith(`${root}/`)) continue;
    if (changed.has(file)) pending = true;
    else aiTouched.delete(file);
  }

  const current = repo.inputBox.value;
  if (pending && enabled()) {
    const next = addTrailerToInput(current);
    if (next !== current) repo.inputBox.value = next;
  } else if (!pending && hasCoAuthor(current)) {
    const next = removeTrailerFromInput(current);
    if (next !== current) repo.inputBox.value = next;
  }
}

function syncAll(): void {
  for (const repo of api?.repositories ?? []) {
    try { sync(repo); } catch { /* bir depo hatası diğerlerini durdurmasın */ }
  }
}

/** tools.ts: Tulvez Code bir dosyayı yazdığında çağrılır. */
export function noteAiEdit(filePath: string): void {
  aiTouched.add(norm(filePath));
  // git durumu dosya yazıldıktan biraz sonra güncellenir; state.onDidChange zaten tetikler,
  // bu çağrı yalnızca durum değişmezse (dosya zaten değişmişti) diye.
  setTimeout(syncAll, 300);
}

export async function activateCoAuthorScm(context: vscode.ExtensionContext): Promise<void> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return;
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    api = exports.getAPI(1);
  } catch {
    return; // git eklentisi kapalı ya da git kurulu değil
  }

  const watch = (repo: GitRepository): void => {
    context.subscriptions.push(repo.state.onDidChange(() => sync(repo)));
  };
  api.repositories.forEach(watch);
  context.subscriptions.push(
    api.onDidOpenRepository((repo) => { watch(repo); sync(repo); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('tulvez.gitCoAuthor')) return;
      if (enabled()) { syncAll(); return; }
      for (const repo of api?.repositories ?? []) {
        const next = removeTrailerFromInput(repo.inputBox.value);
        if (next !== repo.inputBox.value) repo.inputBox.value = next;
      }
    }),
    // "Commit mesajı üret" gibi düğmeler kutuyu baştan yazabilir; pencereye dönüldüğünde tazele
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) syncAll(); }),
  );
}
