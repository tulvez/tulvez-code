import { describe, expect, it } from 'vitest';

const { chatFileName } = await import('../services/chatExport');

const D = new Date(2026, 9, 23, 22, 15);

describe('sohbet dosya adı', () => {
  it('tarih + sohbet adı', () => {
    expect(chatFileName('README güncel değil, araç listesini düzelt', D)).toBe('2026-10-23 README güncel değil araç listesini düzelt.md');
  });

  it('Windows\'ta geçersiz karakterleri atar', () => {
    expect(chatFileName('src/agent.ts: retry? <neden> "çalışmıyor" | *', D)).toBe('2026-10-23 srcagentts retry neden çalışmıyor.md');
  });

  it('boş ad yerine "Sohbet" yazar', () => {
    expect(chatFileName('   ', D)).toBe('2026-10-23 Sohbet.md');
  });

  it('çok uzun adı kısaltır, sonda boşluk/nokta bırakmaz', () => {
    const name = chatFileName(`${'a'.repeat(79)} b c`, D);
    expect(name.length).toBeLessThanOrEqual('2026-10-23 '.length + 80 + 3);
    expect(name).not.toMatch(/\s\.md$/);
  });
});
