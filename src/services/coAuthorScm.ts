import * as vscode from 'vscode';
import { CO_AUTHOR_TRAILER, appendTrailer, hasCoAuthor } from './gitIdentity';
import {
  addToList, filesInHead, installHook, listIntersects, pruneList, relPath, removeHook, repoPaths, repoRootOf,
  type RepoPaths,
} from './coAuthorHook';

/**
 * Copilot gibi ek katkıcı. Tulvez Code bir dosyayı değiştirdiyse ve o dosya
 * commit'e giriyorsa commit `Co-authored-by: Tulvez Code …` satırını alır;
 * yazar her zaman kullanıcıdır.
 *
 * İki yol (depo başına):
 * - **kanca** (varsayılan): `.git/hooks/prepare-commit-msg` satırı commit anında,
 *   mesaj kutusunda göstermeden ekler — VS Code'un Copilot için yaptığı gibi.
 *   VS Code'dan, terminalden ya da başka bir araçtan atılan commit fark etmez.
 * - **mesaj kutusu** (yedek): depoda başka bir kanca ya da core.hooksPath (husky)
 *   varsa kancaya dokunulmaz; satır Kaynak Denetimi mesaj kutusuna yazılır.
 *
 * İz `.git/tulvez-ai-edits` dosyasında tutulur (VS Code kapansa da kalır);
 * commit'e giren ya da geri alınan dosyanın izi silinir.
 * `tulvez.gitCoAuthor` kapalıysa kanca ve iz silinir, hiçbir şey eklenmez.
 */

// VS Code yerleşik git eklentisinin (vscode.git) kullandığımız kadarı
interface GitChange { uri: vscode.Uri }
interface GitRepositoryState {
  HEAD?: { commit?: string };
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

interface RepoInfo {
  paths: RepoPaths;
  /** kanca bizim ve çalışıyor */
  hook: boolean;
  lastHead?: string;
  /** mesaj kutusu yolunda: kullanıcı satırı sildiyse, yeni bir düzenlemeye kadar geri eklenmez */
  userRemoved: boolean;
  weAdded: boolean;
}

const repos = new Map<string, RepoInfo>();
let api: GitAPI | null = null;

const key = (root: string): string => (process.platform === 'win32' ? root.toLowerCase() : root);

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

/** Depoyu hazırlar: kancayı kurar (olmuyorsa mesaj kutusu yoluna düşer). */
async function prepare(root: string): Promise<RepoInfo | null> {
  const k = key(root);
  const known = repos.get(k);
  if (known) {
    if (!known.hook && enabled()) known.hook = await installHook(known.paths);
    return known;
  }
  const paths = await repoPaths(root);
  if (!paths) return null;
  const info: RepoInfo = { paths, hook: enabled() ? await installHook(paths) : false, userRemoved: false, weAdded: false };
  repos.set(k, info);
  return info;
}

function gitRepoFor(root: string): GitRepository | undefined {
  return api?.repositories.find((r) => key(r.rootUri.fsPath) === key(root));
}

/** Mesaj kutusu yolu: commit'e girecek dosyalarda Tulvez izi varsa satırı ekler/çıkarır. */
async function syncInput(info: RepoInfo, repo: GitRepository): Promise<void> {
  const current = repo.inputBox.value;
  // Kanca çalışıyorsa satır kutuya yazılmaz; daha önce bizim eklediğimiz varsa çıkarılır
  if (info.hook || !enabled()) {
    if (info.weAdded && hasCoAuthor(current)) repo.inputBox.value = removeTrailerFromInput(current);
    info.weAdded = false;
    return;
  }
  // VS Code, hiçbir şey staged değilse bütün değişiklikleri commit'ler
  const staged = repo.state.indexChanges.length > 0
    ? repo.state.indexChanges
    : [...repo.state.workingTreeChanges, ...(repo.state.untrackedChanges ?? [])];
  const rels = staged.map((c) => relPath(info.paths.root, c.uri.fsPath)).filter((r): r is string => !!r);
  const pending = await listIntersects(info.paths, rels);

  if (pending) {
    if (info.weAdded && !hasCoAuthor(current)) info.userRemoved = true;
    if (info.userRemoved) return;
    const next = addTrailerToInput(current);
    if (next !== current) repo.inputBox.value = next;
    info.weAdded = true;
  } else if (info.weAdded) {
    if (hasCoAuthor(current)) repo.inputBox.value = removeTrailerFromInput(current);
    info.weAdded = false;
  }
}

/** Git durumu değişti: commit'e giren ya da geri alınan dosyaların izini sil, kutuyu güncelle. */
async function onRepoChange(repo: GitRepository): Promise<void> {
  const info = await prepare(repo.rootUri.fsPath);
  if (!info) return;
  const head = repo.state.HEAD?.commit;
  const newCommit = !!head && !!info.lastHead && head !== info.lastHead;
  info.lastHead = head;
  if (await pruneList(info.paths, newCommit ? await filesInHead(info.paths.root) : new Set())) info.userRemoved = false;
  await syncInput(info, repo);
}

const pendingSync = new Map<GitRepository, ReturnType<typeof setTimeout>>();
function scheduleSync(repo: GitRepository): void {
  clearTimeout(pendingSync.get(repo));
  pendingSync.set(repo, setTimeout(() => {
    pendingSync.delete(repo);
    void onRepoChange(repo).catch(() => undefined);
  }, 150));
}

/** tools.ts: Tulvez Code bir dosyayı yazdığında çağrılır. */
export function noteAiEdit(filePath: string): void {
  if (!enabled()) return;
  void (async () => {
    const root = await repoRootOf(filePath);
    if (!root) return;
    const info = await prepare(root);
    if (!info) return;
    if (await addToList(info.paths, filePath)) info.userRemoved = false;
    const repo = gitRepoFor(root);
    if (repo) scheduleSync(repo);
  })().catch(() => undefined);
}

async function disableAll(): Promise<void> {
  for (const info of repos.values()) {
    await removeHook(info.paths);
    info.hook = false;
    const repo = gitRepoFor(info.paths.root);
    if (repo && info.weAdded) repo.inputBox.value = removeTrailerFromInput(repo.inputBox.value);
    info.weAdded = false;
  }
}

export async function activateCoAuthorScm(context: vscode.ExtensionContext): Promise<void> {
  // Git eklentisi olmasa da kanca çalışır; açık klasörlerin depoları hazırlanır
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = await repoRootOf(folder.uri.fsPath);
    if (root && enabled()) {
      const info = await prepare(root);
      if (info) await pruneList(info.paths).catch(() => undefined);
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('tulvez.gitCoAuthor')) return;
      if (!enabled()) { void disableAll(); return; }
      for (const repo of api?.repositories ?? []) scheduleSync(repo);
      for (const info of repos.values()) void prepare(info.paths.root);
    }),
  );

  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return;
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    api = exports.getAPI(1);
  } catch {
    return; // git eklentisi kapalı ya da git kurulu değil
  }

  const watch = (repo: GitRepository): void => {
    context.subscriptions.push(repo.state.onDidChange(() => scheduleSync(repo)));
    scheduleSync(repo);
  };
  api.repositories.forEach(watch);
  context.subscriptions.push(
    api.onDidOpenRepository(watch),
    // "Commit mesajı üret" gibi düğmeler kutuyu baştan yazabilir; pencereye dönüldüğünde tazele
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) for (const repo of api?.repositories ?? []) scheduleSync(repo);
    }),
  );
}
