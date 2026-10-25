import { exec } from 'child_process';

/**
 * Tulvez Code'un GitHub'daki izi: ek katkıcı (co-author).
 *
 * Commit'in yazarı her zaman kullanıcının kendisidir. Tulvez Code'un attığı
 * commit'lere yalnızca bir `Co-authored-by` satırı eklenir; GitHub bu satırı
 * e-postadan tanır ve commit'te yazarın yanında tulvez-code[bot] (GitHub App)
 * avatarını gösterir. Copilot'un yaptığı da budur.
 *
 * E-posta biçimi GitHub'ın noreply biçimidir: <bot-id>+<bot-login>@users.noreply.github.com
 */
export const BOT_NAME = 'Tulvez Code';
export const BOT_LOGIN = 'tulvez-code[bot]';
export const BOT_EMAIL = '343685009+tulvez-code[bot]@users.noreply.github.com';
export const CO_AUTHOR_TRAILER = `Co-authored-by: ${BOT_NAME} <${BOT_EMAIL}>`;

export interface GitIdentity {
  name: string;
  email: string;
}

type Runner = (args: string, cwd: string) => Promise<{ stdout: string; stderr: string; code: number }>;

const defaultRunner: Runner = (args, cwd) =>
  new Promise((resolve) => {
    exec(`git ${args}`, { cwd }, (err, stdout, stderr) => {
      resolve({
        stdout: (stdout ?? '').trim(),
        stderr: (stderr ?? '').trim(),
        code: err && typeof err.code === 'number' ? err.code : 0,
      });
    });
  });

/** Metinde Tulvez Code ek katkıcı satırı zaten var mı? */
export function hasCoAuthor(text: string): boolean {
  return /co-authored-by:[^\n]*343685009\+tulvez-code\[bot\]@users\.noreply\.github\.com/i.test(text);
}

/**
 * Satırı mesajın sonuna ekler. Son paragraf zaten ek satırlardan oluşuyorsa
 * (ör. başka bir Co-authored-by) araya boş satır koymadan altına yazar; aksi halde
 * git son paragrafı ek bloğu saymaz ve önceki satır sıradan metne dönüşür.
 */
export function appendTrailer(body: string): string {
  const paragraphs = body.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1] ?? '';
  const isTrailerBlock = paragraphs.length > 1
    && last.split('\n').every((line) => /^[A-Za-z][\w-]*:\s+\S/.test(line.trim()));
  return `${body}${isTrailerBlock ? '\n' : '\n\n'}${CO_AUTHOR_TRAILER}`;
}

/** Commit mesajının sonuna ek katkıcı satırını ekler (zaten varsa dokunmaz). */
export function withCoAuthor(message: string): string {
  const body = message.replace(/\s+$/, '');
  if (!body || hasCoAuthor(body)) return body;
  return appendTrailer(body);
}

/**
 * Ajanın çalıştırdığı kabuk komutundaki her `git commit` çağrısına
 * `--trailer` ekler (git 2.32+). `git commit-tree` gibi başka alt komutlara
 * ve satırı zaten içeren komutlara dokunmaz.
 */
export function addCoAuthorToCommand(command: string): string {
  if (hasCoAuthor(command)) return command;
  return command.replace(
    /\bgit((?:\s+-[cC]\s+\S+)*)\s+commit(?=\s|$)/g,
    (match) => `${match} --trailer "${CO_AUTHOR_TRAILER}"`,
  );
}

const COMMIT_RE = /\bgit((?:\s+-[cC]\s+\S+)*)\s+commit(?=\s|$)/;

/** Komut bir `git commit` çalıştırıyor mu? */
export function isCommitCommand(command: string): boolean {
  return COMMIT_RE.test(command);
}

/** Kabuk komutuna güvenle konabilecek ad/e-posta (tırnak, değişken, kaçış karakterleri atılır). */
function shellSafe(text: string): string {
  return text.replace(/["`$%!\\\r\n]/g, '').trim();
}

/**
 * Tulvez Code commit'i kendisi atarken (yazar Tulvez, ayar açıksa) kullanıcıyı
 * ek katkıcı olarak ekler — Copilot'un kendi attığı commit'lerdeki gibi.
 */
export function addUserCoAuthorToCommand(command: string, user: GitIdentity | null): string {
  if (!user) return command;
  const name = shellSafe(user.name);
  const email = shellSafe(user.email);
  if (!name || !/^[^\s<>@]+@[^\s<>@]+$/.test(email)) return command;
  if (email.toLowerCase() === BOT_EMAIL.toLowerCase()) return command;
  const trailer = `Co-authored-by: ${name} <${email}>`;
  if (command.includes(`<${email}>`)) return command;
  return command.replace(new RegExp(COMMIT_RE.source, 'g'), (match) => `${match} --trailer "${trailer}"`);
}

/** Yazarı Tulvez Code yapan ortam değişkenleri (git yapılandırmasına dokunmadan, yalnız o komut için). */
export const BOT_AUTHOR_ENV = { GIT_AUTHOR_NAME: BOT_NAME, GIT_AUTHOR_EMAIL: BOT_EMAIL } as const;

export async function repoRoot(cwd: string, run: Runner = defaultRunner): Promise<string | null> {
  const res = await run('rev-parse --show-toplevel', cwd);
  if (res.code !== 0 || !res.stdout) return null;
  return res.stdout.split(/\r?\n/)[0];
}

export async function readIdentity(cwd: string, run: Runner = defaultRunner, scope: '' | '--local' | '--global' = ''): Promise<GitIdentity | null> {
  const prefix = scope ? `config ${scope}` : 'config';
  const [name, email] = await Promise.all([run(`${prefix} user.name`, cwd), run(`${prefix} user.email`, cwd)]);
  if (!name.stdout && !email.stdout) return null;
  return { name: name.stdout, email: email.stdout };
}

export function isBotIdentity(identity: GitIdentity | null): boolean {
  return !!identity && identity.email === BOT_EMAIL;
}

/**
 * Eski sürümlerin (0.1.x) depoya yazdığı bot kimliğini kaldırır.
 * Yalnızca bu deponun .git/config dosyasına dokunur; global ayarlar yerinde kalır.
 */
export async function removeBotIdentity(cwd: string, run: Runner = defaultRunner): Promise<void> {
  await run('config --local --unset user.name', cwd);
  await run('config --local --unset user.email', cwd);
}
