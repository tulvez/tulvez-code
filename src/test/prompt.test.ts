import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { setWorkspaceRoot } from './setup';

const { buildPrompt } = await import('../services/ai');

describe('sistem istemi', () => {
  // Varsayılan istem sınanır: depodaki code_skills.md (ya da başka bir çalışma alanı dosyası) okunmasın
  let root = '';
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-prompt-'));
    setWorkspaceRoot(root);
  });

  it('code_skills.md her istekte okunur; düzenleme yeniden yüklemeden geçerli olur', () => {
    expect(buildPrompt('build', '')).toContain('Adın Tulvez Code.');
    fs.writeFileSync(path.join(root, 'code_skills.md'), '# Kimlik\n\nProje kuralı: yalnız Rust yaz.\n', 'utf8');
    const p = buildPrompt('build', '');
    expect(p).toContain('Proje kuralı: yalnız Rust yaz.');
    expect(p).toContain('Konuşma kuralları:');
  });

  it('model kendi modunu bilir (kullanıcı "hangi moddasın" diye sorabilir)', () => {
    expect(buildPrompt('ask', '')).toContain('Şu anki modun: Ask');
    expect(buildPrompt('plan', '')).toContain('Şu anki modun: Plan');
    expect(buildPrompt('build', '')).toContain('Şu anki modun: Build');
  });

  it('modeli "Sen Tulvez Code" diye tanıtmaz; kendinden birinci tekil şahısla bahsetmesini ister', () => {
    for (const mode of ['ask', 'plan', 'build'] as const) {
      const p = buildPrompt(mode, '');
      expect(p).not.toMatch(/Sen Tulvez Code/);
      expect(p).toContain('birinci tekil şahısla');
      expect(p).toContain('hangi modda olduğunu sorarsa');
    }
  });

  it('AGENTS.md ve CLAUDE.md proje talimatı olarak her istekte okunur', () => {
    expect(buildPrompt('build', '')).not.toContain('Proje talimatları');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Testleri pnpm ile çalıştır.', 'utf8');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Commit mesajı İngilizce.', 'utf8');
    const p = buildPrompt('ask', '');
    expect(p).toContain('### AGENTS.md\nTestleri pnpm ile çalıştır.');
    expect(p).toContain('### CLAUDE.md\nCommit mesajı İngilizce.');
    expect(p.indexOf('AGENTS.md')).toBeLessThan(p.indexOf('CLAUDE.md'));
  });

  it('büyük talimat dosyası kısaltılır', () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'a'.repeat(50_000), 'utf8');
    const p = buildPrompt('build', '');
    expect(p).toContain('AGENTS.md kısaltıldı');
    expect(p.length).toBeLessThan(25_000);
  });
});

describe('selamlaşma ve kısa sohbet', () => {
  it('Türkçe harfle, noktalamayla yazılsa da tanınır; iş isteği tanınmaz', async () => {
    const { isTrivialRequest } = await import('../services/agent');
    for (const t of ['merhaba', 'Merhaba!', 'nasılsın', 'Nasılsın?', 'teşekkürler', 'sağ ol', 'günaydın', 'selam tulvez', 'naber']) {
      expect(isTrivialRequest(t), t).toBe(true);
    }
    for (const t of ['bu dizindeki dosyaları oku', 'merhaba, README yaz', 'testleri çalıştır']) {
      expect(isTrivialRequest(t), t).toBe(false);
    }
  });

  it('küçük istem: proje talimatı ve araç yönergesi gitmez, kimlik ve mod kalır', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-chat-'));
    setWorkspaceRoot(root);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'UZUN PROJE KURALI', 'utf8');
    const { buildChatPrompt } = await import('../services/ai');
    const p = buildChatPrompt('build');
    expect(p).toContain('Adın Tulvez Code.');
    expect(p).toContain('Şu anki modun: Build');
    expect(p).not.toContain('UZUN PROJE KURALI');
    expect(p).not.toContain('Araç kullanımı:');
    expect(p.length).toBeLessThan(buildPrompt('build', '').length / 2);
  });
});
