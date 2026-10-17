import { exec } from 'child_process';

/**
 * Tulvez Code'un commit kimligi.
 *
 * Uretilen commit'lerin GitHub'da "Tulvez Code" botu olarak gorunmesi icin
 * kullanilir. Bot kullanici id'si GitHub App'in bot hesabina aittir
 * (users.noreply.github.com formatinda: <bot-id>+<bot-login>@users.noreply.github.com).
 */
export const BOT_NAME = 'Tulvez Code';
export const BOT_EMAIL = '343685009+tulvez-code[bot]@users.noreply.github.com';

export interface GitIdentity {
  name: string;
  email: string;
}

export const IDENTITY_KEY = 'tulvez.gitIdentity.applied';

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

export async function repoRoot(cwd: string, run: Runner = defaultRunner): Promise<string | null> {
  const res = await run('rev-parse --show-toplevel', cwd);
  if (res.code !== 0 || !res.stdout) return null;
  return res.stdout.split(/\r?\n/)[0];
}

export async function readIdentity(cwd: string, run: Runner = defaultRunner): Promise<GitIdentity | null> {
  const [name, email] = await Promise.all([run('config user.name', cwd), run('config user.email', cwd)]);
  if (!name.stdout && !email.stdout) return null;
  return { name: name.stdout, email: email.stdout };
}

/** Global git ayarlarina hic dokunmaz; yalnizca bu deponun .git/config dosyasina yazar. */
export async function applyBotIdentity(cwd: string, run: Runner = defaultRunner): Promise<void> {
  await run(`config --local user.name "${BOT_NAME}"`, cwd);
  await run(`config --local user.email "${BOT_EMAIL}"`, cwd);
}

export function isBotIdentity(identity: GitIdentity | null): boolean {
  return !!identity && identity.email === BOT_EMAIL;
}

export function needsBotIdentity(identity: GitIdentity | null): boolean {
  return identity !== null && !isBotIdentity(identity);
}