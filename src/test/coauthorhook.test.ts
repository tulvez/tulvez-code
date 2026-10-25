import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const hook = await import('../services/coAuthorHook');
const { CO_AUTHOR_TRAILER } = await import('../services/gitIdentity');

// Gerçek git ile: kancayı kurar, commit atar, mesajı okur.
let dir = '';
const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
const write = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const lastMessage = (): string => git('log', '-1', '--format=%B').trim();

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tz-hook-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Deniz Yılmaz');
  git('config', 'user.email', 'deniz@example.com');
  git('config', 'commit.gpgsign', 'false');
  write('README.md', 'ilk\n');
  git('add', '.');
  git('commit', '-q', '-m', 'ilk');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function setup(): Promise<NonNullable<Awaited<ReturnType<typeof hook.repoPaths>>>> {
  const paths = await hook.repoPaths(dir);
  expect(paths).not.toBeNull();
  expect(await hook.installHook(paths!)).toBe(true);
  return paths!;
}

describe('commit anında ek katkıcı kancası (Copilot gibi)', () => {
  it('Tulvez\'in değiştirdiği dosya commit\'e girince satırı ekler, yazar kullanıcı kalır', async () => {
    const paths = await setup();
    write('src/a.ts', 'export const a = 1;\n');
    await hook.addToList(paths, path.join(dir, 'src/a.ts'));
    git('add', '.');
    git('commit', '-q', '-m', 'feat: a eklendi');
    expect(lastMessage()).toBe(`feat: a eklendi\n\n${CO_AUTHOR_TRAILER}`);
    expect(git('log', '-1', '--format=%an <%ae>').trim()).toBe('Deniz Yılmaz <deniz@example.com>');
  });

  it('commit\'e yalnız başka dosyalar girerse satır eklenmez', async () => {
    const paths = await setup();
    write('ai.ts', '1\n');
    write('el.ts', '2\n');
    await hook.addToList(paths, path.join(dir, 'ai.ts'));
    git('add', 'el.ts');
    git('commit', '-q', '-m', 'yalnız el');
    expect(lastMessage()).toBe('yalnız el');
  });

  it('commit -a (staged değil, izlenen dosya) da sayılır', async () => {
    const paths = await setup();
    write('README.md', 'değişti\n');
    await hook.addToList(paths, path.join(dir, 'README.md'));
    git('commit', '-q', '-am', 'doc');
    expect(lastMessage()).toContain(CO_AUTHOR_TRAILER);
  });

  it('Türkçe karakterli dosya adı', async () => {
    const paths = await setup();
    write('çiçek/ağaç.ts', 'x\n');
    await hook.addToList(paths, path.join(dir, 'çiçek/ağaç.ts'));
    git('add', '.');
    git('commit', '-q', '-m', 'tr');
    expect(lastMessage()).toContain(CO_AUTHOR_TRAILER);
  });

  it('mesajda zaten varsa ikinci kez eklemez; başka ek katkıcıyla aynı bloğa yazar', async () => {
    const paths = await setup();
    write('a.ts', '1\n');
    await hook.addToList(paths, path.join(dir, 'a.ts'));
    git('add', '.');
    git('commit', '-q', '-m', `x\n\n${CO_AUTHOR_TRAILER}`);
    expect(lastMessage().split(CO_AUTHOR_TRAILER).length).toBe(2);

    write('a.ts', '2\n');
    await hook.addToList(paths, path.join(dir, 'a.ts'));
    git('add', '.');
    const other = 'Co-authored-by: Copilot <copilot@github.com>';
    git('commit', '-q', '-m', `y\n\n${other}`);
    expect(lastMessage()).toBe(`y\n\n${other}\n${CO_AUTHOR_TRAILER}`);
  });

  it('ajanın kendi git commit --trailer komutuyla birlikte satır tek kalır', async () => {
    const paths = await setup();
    write('a.ts', '1\n');
    await hook.addToList(paths, path.join(dir, 'a.ts'));
    git('add', '.');
    git('commit', '-q', '-m', 'ajan', '--trailer', CO_AUTHOR_TRAILER);
    expect(lastMessage()).toBe(`ajan\n\n${CO_AUTHOR_TRAILER}`);
  });

  it('commit sonrası iz temizlenir; aynı dosya sonra elle değişirse satır eklenmez', async () => {
    const paths = await setup();
    write('a.ts', '1\n');
    await hook.addToList(paths, path.join(dir, 'a.ts'));
    git('add', '.');
    git('commit', '-q', '-m', 'ai');
    write('a.ts', '2\n'); // kullanıcı elle değiştirdi
    await hook.pruneList(paths, await hook.filesInHead(dir));
    expect((await hook.readList(paths.listFile)).size).toBe(0);
    git('commit', '-q', '-am', 'el');
    expect(lastMessage()).toBe('el');
  });

  it('"değişiklikleri at" sonrası iz temizlenir', async () => {
    const paths = await setup();
    write('README.md', 'ai yazdı\n');
    await hook.addToList(paths, path.join(dir, 'README.md'));
    git('checkout', '--', 'README.md');
    expect(await hook.pruneList(paths)).toBe(true);
    expect(fs.existsSync(paths.listFile)).toBe(false);
  });

  it('30 günden eski liste yok sayılır (eklenti kaldırıldıysa satır sürüp gitmesin)', async () => {
    const paths = await setup();
    write('a.ts', '1\n');
    await hook.addToList(paths, path.join(dir, 'a.ts'));
    const eski = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    fs.utimesSync(paths.listFile, eski, eski);
    git('add', '.');
    git('commit', '-q', '-m', 'eski');
    expect(lastMessage()).toBe('eski');
  });

  it('kullanıcının kendi kancasına dokunmaz', async () => {
    const paths = (await hook.repoPaths(dir))!;
    fs.mkdirSync(path.dirname(paths.hookFile!), { recursive: true });
    fs.writeFileSync(paths.hookFile!, '#!/bin/sh\necho benim\n', { mode: 0o755 });
    expect(await hook.installHook(paths)).toBe(false);
    await hook.removeHook(paths);
    expect(fs.readFileSync(paths.hookFile!, 'utf8')).toBe('#!/bin/sh\necho benim\n');
  });

  it('core.hooksPath (husky vb.) varsa kanca kurulmaz', async () => {
    git('config', 'core.hooksPath', '.husky');
    const paths = (await hook.repoPaths(dir))!;
    expect(paths.hookFile).toBeNull();
    expect(await hook.installHook(paths)).toBe(false);
    expect(fs.existsSync(path.join(dir, '.husky'))).toBe(false);
  });

  it('ayar kapatılınca bizim kanca ve liste silinir', async () => {
    const paths = await setup();
    write('a.ts', '1\n');
    await hook.addToList(paths, path.join(dir, 'a.ts'));
    await hook.removeHook(paths);
    expect(fs.existsSync(paths.hookFile!)).toBe(false);
    expect(fs.existsSync(paths.listFile)).toBe(false);
  });

  it('depo dışındaki dosya listeye girmez', async () => {
    const paths = await setup();
    expect(await hook.addToList(paths, path.join(os.tmpdir(), 'baska.ts'))).toBe(false);
  });
});
