import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { setWorkspaceRoot } from './setup';
import { kisaAciklama, slashMenu } from '../../webview/src/lib/slashMenu';

const vscode = await import('vscode');
const { L, currentLang } = await import('../services/i18n');
const { buildPrompt } = await import('../services/ai');
const { freeOnlyMessage } = await import('../services/opencode');

type Ws = { getConfiguration: (s?: string) => { get: (k: string, d?: unknown) => unknown; update: () => void } };
const ws = vscode.workspace as unknown as Ws;
const asil = ws.getConfiguration;
const dilAyarla = (dil: string | undefined) => {
  ws.getConfiguration = () => ({ get: (k: string, d?: unknown) => (k === 'language' && dil ? dil : d), update: () => undefined });
};
afterEach(() => { ws.getConfiguration = asil; });

describe('dil', () => {
  it('ayar yoksa (testte VS Code dili de yok) Türkçe; ayar en ise İngilizce', () => {
    dilAyarla(undefined);
    expect(currentLang()).toBe('tr');
    expect(L('Merhaba', 'Hello')).toBe('Merhaba');
    dilAyarla('en');
    expect(currentLang()).toBe('en');
    expect(L('Merhaba', 'Hello')).toBe('Hello');
  });

  it('modele yanıt dili söylenir; İngilizce\'de mesajlar İngilizce', () => {
    setWorkspaceRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'tz-dil-')));
    dilAyarla('tr');
    expect(buildPrompt('ask', '')).toContain('kullanıcıya Türkçe yanıt ver');
    dilAyarla('en');
    expect(buildPrompt('ask', '')).toContain('reply to the user in English');
    expect(freeOnlyMessage()).toMatch(/^This free model only works in the OpenCode app/);
  });
});

describe('beceri açıklaması gösterimi', () => {
  it('100 karakterde kelime ortasından bölmeden kısaltılır', () => {
    const uzun = 'Estimates how many users an app can serve on its current hosting stack and plan, which limit breaks first, and what it costs.';
    const k = kisaAciklama(uzun);
    expect(k.length).toBeLessThanOrEqual(100);
    expect(k.endsWith('…')).toBe(true);
    expect(uzun.startsWith(k.slice(0, -1))).toBe(true);
    expect(k.slice(0, -1)).not.toMatch(/\s$/);
    expect(kisaAciklama('Kısa açıklama')).toBe('Kısa açıklama');
    expect(kisaAciklama('  boşluklar\n  sadeleşir  ')).toBe('boşluklar sadeleşir');
  });

  it('/ menüsündeki beceri açıklaması da kısaltılır; menü türü dile bağlı değil', () => {
    const m = slashMenu('/skill', [], [{ name: 'a', description: 'x '.repeat(200) }]);
    expect(m?.kind).toBe('skills');
    expect(m?.items[0].hint.length).toBeLessThanOrEqual(100);
    expect(slashMenu('/', [{ cmd: '/run', hint: '' }], [])?.kind).toBe('commands');
  });
});
