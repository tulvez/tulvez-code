import { getNativeClipboard } from '@earendil-works/pi-tui';
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

export interface ClipboardImage {
  data: Uint8Array;
  mediaType: string;
}

/** Görselin türü ilk baytlarından (PNG, JPEG, GIF, WebP); tanınmazsa null */
export function imageType(data: Uint8Array): string | null {
  const b = data;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function runBuffer(file: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 4000, windowsHide: true, maxBuffer: MAX_IMAGE_BYTES, encoding: 'buffer' }, (err, stdout) => {
      resolve(err || !stdout.length ? null : stdout);
    });
  });
}

/**
 * Panodaki görsel (ekran görüntüsü). Önce pi-tui'nin yerel yardımcısı (Windows, macOS, Linux X11),
 * olmazsa Wayland/X11 komutları. Görsel yoksa ya da okunamazsa null.
 */
export async function readClipboardImage(): Promise<ClipboardImage | null> {
  const fromBytes = (data: Uint8Array | null | undefined): ClipboardImage | null => {
    if (!data || !data.length || data.length > MAX_IMAGE_BYTES) return null;
    const mediaType = imageType(data);
    return mediaType ? { data, mediaType } : null;
  };
  try {
    const img = fromBytes(await getNativeClipboard()?.getImage());
    if (img) return img;
  } catch { /* yerel yardımcı yok ya da okunamadı */ }
  if (process.platform === 'linux') {
    for (const [file, args] of [['wl-paste', ['--type', 'image/png']], ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']]] as const) {
      const img = fromBytes(await runBuffer(file, [...args]));
      if (img) return img;
    }
  }
  return null;
}
