import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Geliştirme günlüğü (yalnız F5 / Extension Development Host).
 *
 * Açılışın her adımı, yakalanmamış hatalar, webview hataları ve süreç çıkışı
 * eklenti klasöründeki `.tulvez-dev.log` dosyasına yazılır. Pencere kendiliğinden
 * kapandığında neyin son çalıştığı buradan okunur. Yayımlanan eklentide hiçbir şey yazmaz.
 */

let file: string | null = null;

export function initDevLog(context: vscode.ExtensionContext): void {
  if (context.extensionMode !== vscode.ExtensionMode.Development) return;
  file = path.join(context.extensionUri.fsPath, '.tulvez-dev.log');
  try {
    // her F5'te yeni oturum; önceki oturum .1 olarak saklanır
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.1`);
    fs.writeFileSync(file, '');
  } catch { /* yazılamıyorsa sessiz geç */ }
  devLog('oturum', `VS Code ${vscode.version} · ${process.platform} ${process.arch} · node ${process.versions.node} · electron ${process.versions.electron ?? '?'}`);
  process.on('uncaughtException', (err) => devLog('YAKALANMAMIŞ HATA', err?.stack ?? String(err)));
  process.on('unhandledRejection', (err) => devLog('YAKALANMAMIŞ SÖZ (promise)', err instanceof Error ? err.stack ?? err.message : String(err)));
  process.on('exit', (code) => devLog('eklenti süreci çıkıyor', `kod ${code}`));
}

export function devLog(step: string, detail = ''): void {
  if (!file) return;
  const line = `${new Date().toISOString().slice(11, 23)}  ${step}${detail ? ` — ${detail.replace(/\s+$/, '')}` : ''}\n`;
  try { fs.appendFileSync(file, line); } catch { /* yoksay */ }
}

/** Bir açılış adımını çalıştırır; hata atarsa günlüğe yazar ve açılışı durdurmaz. */
export function step<T>(name: string, fn: () => T): T | undefined {
  devLog(`→ ${name}`);
  try {
    const out = fn();
    devLog(`✓ ${name}`);
    return out;
  } catch (err) {
    devLog(`✗ ${name}`, err instanceof Error ? err.stack ?? err.message : String(err));
    return undefined;
  }
}
