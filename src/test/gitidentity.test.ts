import { describe, expect, it } from 'vitest';

const {
  isBotIdentity, readIdentity, removeBotIdentity, repoRoot, withCoAuthor, addCoAuthorToCommand, hasCoAuthor,
  BOT_EMAIL, BOT_NAME, CO_AUTHOR_TRAILER,
} = await import('../services/gitIdentity');

type Res = { stdout: string; stderr: string; code: number };
type Runner = (args: string, cwd: string) => Promise<Res>;

const ok = (stdout: string): Res => ({ stdout, stderr: '', code: 0 });
const fail = (): Res => ({ stdout: '', stderr: 'fatal', code: 128 });

const makeRunner = (answers: Record<string, Res>) => {
  const calls: string[] = [];
  const run: Runner = async (args) => {
    calls.push(args);
    return answers[args] ?? fail();
  };
  return { run, calls };
};

// Örnek kullanıcı — gerçek bir kişiye ait değil
const USER = { name: 'Deniz Yılmaz', email: 'deniz@example.com' };

describe('Tulvez Code ek katkıcı (co-author)', () => {
  it('bot e-postası gerçek bot hesabına ait olmalı', () => {
    // GitHub, <bot-id>+<bot-login>@users.noreply.github.com biçimini bekler.
    expect(BOT_EMAIL).toBe('343685009+tulvez-code[bot]@users.noreply.github.com');
    expect(BOT_NAME).toBe('Tulvez Code');
    expect(CO_AUTHOR_TRAILER).toBe('Co-authored-by: Tulvez Code <343685009+tulvez-code[bot]@users.noreply.github.com>');
  });

  it('bot e-postasındaki sayı, kullanıcı hesabına değil bot hesabına ait olmalı', async () => {
    const id = BOT_EMAIL.split('+')[0];
    const res = await fetch(`https://api.github.com/user/${id}`, {
      headers: { 'User-Agent': 'tulvez-code-test' },
    }).catch(() => null);
    if (!res?.ok) return; // ağ yoksa sessizce geç
    const body = (await res.json()) as { login: string; type: string };
    expect(body.login, 'bot e-postası gerçek bot hesabına işaret etmeli').toBe('tulvez-code[bot]');
    expect(body.type).toBe('Bot');
  });

  it('commit mesajının sonuna boş satırla ek katkıcı ekler', () => {
    expect(withCoAuthor('[ai]: retry eklendi')).toBe(`[ai]: retry eklendi\n\n${CO_AUTHOR_TRAILER}`);
  });

  it('satır zaten varsa ikinci kez eklemez', () => {
    const once = withCoAuthor('fix: x');
    expect(withCoAuthor(once)).toBe(once);
    expect(hasCoAuthor(once)).toBe(true);
  });

  it('boş mesaja dokunmaz', () => {
    expect(withCoAuthor('   ')).toBe('');
  });

  it('ajan komutundaki git commit çağrısına --trailer ekler', () => {
    const out = addCoAuthorToCommand('git add -A && git commit -m "fix: x"');
    expect(out).toBe(`git add -A && git commit --trailer "${CO_AUTHOR_TRAILER}" -m "fix: x"`);
  });

  it('git -C ile çağrılan commit de yakalanır', () => {
    const out = addCoAuthorToCommand('git -C ../repo commit -am "y"');
    expect(out).toContain(`git -C ../repo commit --trailer "${CO_AUTHOR_TRAILER}" -am "y"`);
  });

  it('birden çok commit varsa her birine eklenir', () => {
    const out = addCoAuthorToCommand('git commit -m a; git commit -m b');
    expect(out.split('--trailer').length - 1).toBe(2);
  });

  it('commit dışındaki git komutlarına dokunmaz', () => {
    for (const cmd of ['git status', 'git commit-tree HEAD^{tree}', 'git log --grep commit', 'npm run commit']) {
      expect(addCoAuthorToCommand(cmd)).toBe(cmd);
    }
  });

  it('satırı zaten içeren komuta dokunmaz', () => {
    const cmd = `git commit -m "x" --trailer "${CO_AUTHOR_TRAILER}"`;
    expect(addCoAuthorToCommand(cmd)).toBe(cmd);
  });
});

describe('eski bot kimliği (0.1.x)', () => {
  it('bot kimliğini tanır', () => {
    expect(isBotIdentity({ name: BOT_NAME, email: BOT_EMAIL })).toBe(true);
    expect(isBotIdentity(USER)).toBe(false);
    expect(isBotIdentity(null)).toBe(false);
  });

  it('kaldırırken yalnızca yerel (--local) ayara dokunur', async () => {
    const { run, calls } = makeRunner({});
    await removeBotIdentity('/repo', run);
    expect(calls).toEqual(['config --local --unset user.name', 'config --local --unset user.email']);
  });
});

describe('git yardımcıları', () => {
  it('git deposu değilse null döner', async () => {
    const { run } = makeRunner({});
    expect(await repoRoot('/tmp', run)).toBeNull();
  });

  it('depo kökünü okur', async () => {
    const { run } = makeRunner({ 'rev-parse --show-toplevel': ok('/home/user/proje') });
    expect(await repoRoot('/home/user/proje/src', run)).toBe('/home/user/proje');
  });

  it('kimliği okur', async () => {
    const { run } = makeRunner({
      'config user.name': ok(USER.name),
      'config user.email': ok(USER.email),
    });
    expect(await readIdentity('/repo', run)).toEqual(USER);
  });

  it('global kimliği ayrı okur', async () => {
    const { run, calls } = makeRunner({
      'config --global user.name': ok(USER.name),
      'config --global user.email': ok(USER.email),
    });
    expect(await readIdentity('/repo', run, '--global')).toEqual(USER);
    expect(calls.every((c) => c.includes('--global'))).toBe(true);
  });

  it('kimlik hiç tanımlı değilse null döner', async () => {
    const { run } = makeRunner({});
    expect(await readIdentity('/repo', run)).toBeNull();
  });
});
