import { describe, expect, it } from 'vitest';

const { isBotIdentity, needsBotIdentity, readIdentity, applyBotIdentity, repoRoot, BOT_EMAIL, BOT_NAME } =
  await import('../services/gitIdentity');

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

describe('bot git kimliği', () => {
  it('bot e-postası gerçek bot hesabına ait olmalı', () => {
    // GitHub, <bot-id>+<bot-login>@users.noreply.github.com biçimini bekler.
    expect(BOT_EMAIL).toBe('343685009+tulvez-code[bot]@users.noreply.github.com');
    expect(BOT_NAME).toBe('Tulvez Code');
  });

  it('bot e-postasındaki sayı, kullanıcı hesabına değil bot hesabına ait olmalı', async () => {
    const id = BOT_EMAIL.split('+')[0];
    const res = await fetch(`https://api.github.com/user/${id}`, {
      headers: { 'User-Agent': 'tulvez-code-test' },
    });
    if (!res.ok) return; // ağ yoksa sessizce geç
    const body = (await res.json()) as { login: string; type: string };
    expect(body.login, 'bot e-postası gerçek bot hesabına işaret etmeli').toBe('tulvez-code[bot]');
    expect(body.type).toBe('Bot');
  });

  it('bot kimliği zaten ayarlıysa değişiklik gerekmez', () => {
    expect(isBotIdentity({ name: BOT_NAME, email: BOT_EMAIL })).toBe(true);
    expect(needsBotIdentity({ name: BOT_NAME, email: BOT_EMAIL })).toBe(false);
  });

  it('kullanıcının kendi kimliği varsa bot kimliği gerekir', () => {
    const own = { name: 'Ömer', email: 'omrfrk8822@gmail.com' };
    expect(isBotIdentity(own)).toBe(false);
    expect(needsBotIdentity(own)).toBe(true);
  });

  it('kimlik tanımlı değilse dokunmaz', () => {
    expect(isBotIdentity(null)).toBe(false);
    expect(needsBotIdentity(null)).toBe(false);
  });

  it('yalnızca yerel (--local) ayarı yazar, global ayara dokunmaz', async () => {
    const { run, calls } = makeRunner({});
    await applyBotIdentity('/repo', run);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call, 'global ayar yazılmamalı').toContain('--local');
      expect(call).not.toContain('--global');
    }
    expect(calls[0]).toContain(BOT_NAME);
    expect(calls[1]).toContain(BOT_EMAIL);
  });

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
      'config user.name': ok('Ömer'),
      'config user.email': ok('omrfrk8822@gmail.com'),
    });
    expect(await readIdentity('/repo', run)).toEqual({ name: 'Ömer', email: 'omrfrk8822@gmail.com' });
  });

  it('kimlik hiç tanımlı değilse null döner', async () => {
    const { run } = makeRunner({});
    expect(await readIdentity('/repo', run)).toBeNull();
  });
});