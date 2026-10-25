import { describe, expect, it } from 'vitest';

const { parseIndex, registryBase, splitSkillFile } = await import('../services/skillsRegistry');

describe('skills deposu: index.json', () => {
  it('geçerli kayıtları okur', () => {
    const list = parseIndex({
      version: 1,
      skills: [{ id: 'test-yaz', name: 'Test yaz', description: 'Birim testi yazar', file: 'skills/test-yaz.md', tags: ['test'], version: '1.0.0' }],
    });
    expect(list).toEqual([{ id: 'test-yaz', name: 'Test yaz', description: 'Birim testi yazar', file: 'skills/test-yaz.md', tags: ['test'], version: '1.0.0' }]);
  });

  it('tehlikeli ya da bozuk kayıtları atar', () => {
    const list = parseIndex({
      skills: [
        { id: '../kaçış', file: 'skills/a.md' },
        { id: 'yol-kacisi', file: '../../etc/passwd.md' },
        { id: 'mutlak', file: '/etc/x.md' },
        { id: 'ters-bolu', file: 'skills\\x.md' },
        { id: 'md-degil', file: 'skills/x.sh' },
        { id: 'BUYUK', file: 'skills/x.md' },
        null,
        { id: 'iyi', file: 'skills/iyi.md' },
      ],
    });
    expect(list.map((s) => s.id)).toEqual(['iyi']);
    expect(list[0].name).toBe('iyi'); // ad yoksa kimlik
  });

  it('skills listesi yoksa hata verir', () => {
    expect(() => parseIndex({ version: 1 })).toThrow();
    expect(() => parseIndex(null)).toThrow();
  });
});

describe('skill dosyası', () => {
  it('ilk # başlık ad, kalanı talimat', () => {
    expect(splitSkillFile('test-yaz', '# Test yaz\n\nÖnce mevcut testlere bak.\n')).toEqual({
      id: 'test-yaz', name: 'Test yaz', text: 'Önce mevcut testlere bak.',
    });
  });

  it('başlık yoksa kimlik ad olur', () => {
    expect(splitSkillFile('x', 'Sadece talimat')).toEqual({ id: 'x', name: 'x', text: 'Sadece talimat' });
  });
});

describe('beceri adresi', () => {
  const setValue = async (v: string | undefined) => {
    const vscode = await import('vscode');
    (vscode.workspace as unknown as { getConfiguration: () => unknown }).getConfiguration = () => ({ get: () => v });
  };

  it('ayar yoksa GitHub hesabı', async () => {
    await setValue(undefined);
    expect(registryBase()).toBe('https://github.com/tulvez');
  });

  it('ayar dosyasında eski (hiç yayımlanmamış) varsayılan kalmışsa yenisi kullanılır', async () => {
    await setValue('https://raw.githubusercontent.com/tulvez/tulvez-code-skills/main/');
    expect(registryBase()).toBe('https://github.com/tulvez');
  });

  it('kullanıcının kendi adresine dokunulmaz', async () => {
    await setValue('https://ornek.dev/skills/');
    expect(registryBase()).toBe('https://ornek.dev/skills');
  });
});
