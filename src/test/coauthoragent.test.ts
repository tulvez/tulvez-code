import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { agentCommand, shellInvocation } = await import('../services/tools');
const { addUserCoAuthorToCommand, isCommitCommand, BOT_EMAIL, CO_AUTHOR_TRAILER } = await import('../services/gitIdentity');
const hook = await import('../services/coAuthorHook');

type Stub = { workspace: { getConfiguration: () => { get: (k: string, d?: unknown) => unknown } } };
const stub = (globalThis as { __vscodeStub?: Stub }).__vscodeStub!;
const setConfig = (values: Record<string, unknown>): void => {
  stub.workspace.getConfiguration = () => ({ get: (k: string, d?: unknown) => (k in values ? values[k] : d) });
};

let dir = '';
const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

/** Ajanın run_command aracının yaptığı gibi: komutu sarmala, kabukta çalıştır. */
async function runAsAgent(raw: string): Promise<void> {
  const run = await agentCommand(raw, dir);
  const sh = shellInvocation(run.command);
  const res = spawnSync(sh.file, sh.args, { cwd: dir, env: run.env, encoding: 'utf8', windowsVerbatimArguments: sh.windowsVerbatimArguments });
  expect(res.status, res.stderr).toBe(0);
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tz-agent-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Deniz Yılmaz');
  git('config', 'user.email', 'deniz@example.com');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
  git('add', '.');
  git('commit', '-q', '-m', 'ilk');
  fs.writeFileSync(path.join(dir, 'a.txt'), '2\n');
  git('add', '.');
});

afterEach(() => {
  setConfig({});
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ajanın kendi attığı commit', () => {
  it('ek katkıcı ayarı kapalıysa komuta dokunulmaz: yazar kullanıcı, satır yok', async () => {
    setConfig({ gitCoAuthor: false });
    await runAsAgent('git commit -m "feat: ajan"');
    expect(git('log', '-1', '--format=%an <%ae>').trim()).toBe('Deniz Yılmaz <deniz@example.com>');
    expect(git('log', '-1', '--format=%B').trim()).toBe('feat: ajan');
  });

  it('yazar Tulvez Code, kullanıcı ek katkıcı (Copilot gibi); git ayarı değişmez', async () => {
    setConfig({});
    await runAsAgent('git commit -m "feat: ajan"');
    expect(git('log', '-1', '--format=%an <%ae>').trim()).toBe(`Tulvez Code <${BOT_EMAIL}>`);
    expect(git('log', '-1', '--format=%cn <%ce>').trim()).toBe('Deniz Yılmaz <deniz@example.com>');
    expect(git('log', '-1', '--format=%B').trim()).toBe('feat: ajan\n\nCo-authored-by: Deniz Yılmaz <deniz@example.com>');
    expect(git('config', 'user.name').trim()).toBe('Deniz Yılmaz');
  });

  it('kanca kurulu: bot yazar olduğu için bot ek katkıcı olarak eklenmez', async () => {
    setConfig({});
    const paths = (await hook.repoPaths(dir))!;
    expect(await hook.installHook(paths)).toBe(true);
    await hook.addToList(paths, path.join(dir, 'a.txt'));
    await runAsAgent('git commit -m "feat: kancalı"');
    const body = git('log', '-1', '--format=%B').trim();
    expect(body).not.toContain(CO_AUTHOR_TRAILER);
    expect(body).toContain('Co-authored-by: Deniz Yılmaz <deniz@example.com>');
  });

  it('commit olmayan komutlara dokunulmaz', async () => {
    setConfig({});
    expect(await agentCommand('git status', dir)).toEqual({ command: 'git status' });
  });
});

describe('kullanıcı ek katkıcı satırı', () => {
  it('git commit komutlarını tanır', () => {
    expect(isCommitCommand('git add . && git commit -m x')).toBe(true);
    expect(isCommitCommand('git -C sub commit -m x')).toBe(true);
    expect(isCommitCommand('git log --grep commit')).toBe(false);
  });

  it('ad ve e-postadaki kabuk karakterlerini atar', () => {
    const out = addUserCoAuthorToCommand('git commit -m x', { name: 'A"$(rm -rf /)`b', email: 'a@b.co' });
    expect(out).toBe('git commit --trailer "Co-authored-by: A(rm -rf /)b <a@b.co>" -m x');
  });

  it('geçersiz e-posta ya da kimlik yoksa satır eklenmez', () => {
    expect(addUserCoAuthorToCommand('git commit -m x', null)).toBe('git commit -m x');
    expect(addUserCoAuthorToCommand('git commit -m x', { name: 'A', email: 'yok' })).toBe('git commit -m x');
    expect(addUserCoAuthorToCommand('git commit -m x', { name: 'Bot', email: BOT_EMAIL })).toBe('git commit -m x');
  });
});
