import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Geri alma noktaları: bir yanıtta Tulvez Code'un yazdığı her dosyanın önceki hali.
 *
 * Yazma araçları dosyaya dokunmadan önce `recordBefore` çağırır (dosya yoksa "yoktu" kaydedilir).
 * Yanıt biterken (bitti, durduruldu ya da hata) son haller alınır. Geri alırken dosya o son halden
 * farklıysa (kullanıcı sonradan değiştirmiş) önce onay istenir. Terminal komutlarının yaptığı
 * değişiklikler izlenmez. Yalnız bellekte durur.
 */

interface FileState { before: string | null; after?: string | null }
interface Checkpoint { id: string; files: Map<string, FileState> }

const MAX_CHECKPOINTS = 30;
const store = new Map<string, Checkpoint>();
let active: Checkpoint | null = null;

async function readOrNull(file: string): Promise<string | null> {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

export function beginCheckpoint(id: string): void {
  active = { id, files: new Map() };
}

/** Dosyanın bu yanıttaki ilk değişiklikten önceki hali (yalnız ilk çağrı sayılır). */
export async function recordBefore(fsPath: string): Promise<void> {
  const cp = active;
  if (!cp || cp.files.has(fsPath)) return;
  cp.files.set(fsPath, { before: null });
  cp.files.set(fsPath, { before: await readOrNull(fsPath) });
}

/** Yanıt bitti: dosya değiştiyse geri alma noktası saklanır. Dönüş: değişen dosyalar. */
export async function endCheckpoint(): Promise<{ id: string; files: string[] } | null> {
  const cp = active;
  active = null;
  if (!cp || cp.files.size === 0) return null;
  for (const [file, state] of cp.files) state.after = await readOrNull(file);
  // Yazılıp aynı içeriğe dönen dosyalar sayılmaz
  for (const [file, state] of cp.files) if (state.after === state.before) cp.files.delete(file);
  if (cp.files.size === 0) return null;
  store.set(cp.id, cp);
  while (store.size > MAX_CHECKPOINTS) store.delete(store.keys().next().value as string);
  return { id: cp.id, files: [...cp.files.keys()] };
}

/**
 * Dosyaları yanıttan önceki haline döndürür. `confirm` yalnız kullanıcının sonradan değiştirdiği
 * dosyalar varsa çağrılır; false dönerse hiçbir şeye dokunulmaz.
 */
export async function undoCheckpoint(
  id: string,
  confirm: (changedByUser: string[]) => Promise<boolean>,
): Promise<{ restored: string[]; cancelled: boolean }> {
  const cp = store.get(id);
  if (!cp) throw new Error('Bu yanıtın geri alma kaydı yok (VS Code yeniden açıldıysa kayıt silinir).');
  const changed: string[] = [];
  for (const [file, state] of cp.files) {
    if ((await readOrNull(file)) !== state.after) changed.push(file);
  }
  if (changed.length && !(await confirm(changed))) return { restored: [], cancelled: true };
  const restored: string[] = [];
  for (const [file, state] of cp.files) {
    if (state.before === null) {
      await fs.rm(file, { force: true });
    } else {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, state.before, 'utf8');
    }
    restored.push(file);
  }
  store.delete(id);
  return { restored, cancelled: false };
}
