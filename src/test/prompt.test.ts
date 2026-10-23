import { describe, expect, it } from 'vitest';

const { buildPrompt } = await import('../services/ai');

describe('sistem istemi', () => {
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
});
