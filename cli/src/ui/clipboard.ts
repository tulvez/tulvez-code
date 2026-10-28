import { execFile } from 'child_process';

/**
 * Panodaki metin. Terminal yapıştırmayı kendisi yapmadığında kullanılır: bazı terminallerde
 * (cmd, VS Code) Ctrl+V uygulamaya düz tuş olarak gelir.
 * Okunamazsa null.
 */

type Candidate = [file: string, args: string[]];

function candidates(platform: NodeJS.Platform): Candidate[] {
  if (platform === 'win32') {
    return [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Raw']]];
  }
  if (platform === 'darwin') return [['pbpaste', []]];
  return [
    ['wl-paste', ['--no-newline']],
    ['xclip', ['-selection', 'clipboard', '-o']],
    ['xsel', ['--clipboard', '--output']],
  ];
}

function run([file, args]: Candidate): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 3000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

export async function readClipboard(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  for (const cand of candidates(platform)) {
    const out = await run(cand);
    if (out !== null) return out;
  }
  return null;
}

/** Yapıştırılan metni girişe uygun hale getirir: satır sonları \n, sondaki satır sonu atılır. */
export function normalizePaste(text: string, singleLine: boolean): string {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return singleLine ? t.split('\n').map((l) => l.trim()).join('') : t;
}

function writers(platform: NodeJS.Platform): Candidate[] {
  if (platform === 'win32') {
    return [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::InputEncoding=[System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())']]];
  }
  if (platform === 'darwin') return [['pbcopy', []]];
  return [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
}

/** Metni sistem panosuna yazar (fareyle seçilen metin). Yazılamazsa false. */
export async function writeClipboard(text: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  for (const [file, args] of writers(platform)) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = execFile(file, args, { timeout: 3000, windowsHide: true }, (err) => resolve(!err));
      child.stdin?.on('error', () => resolve(false));
      child.stdin?.end(text, 'utf8');
    });
    if (ok) return true;
  }
  return false;
}
