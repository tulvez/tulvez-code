import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('CLI argümanları', () => {
  it('argümansız etkileşimli oturum, varsayılan build', () => {
    const a = parseArgs([]);
    expect(a.prompt).toBe('');
    expect(a.mode).toBe('build');
    expect(a.yes).toBe(false);
  });

  it('kelimeler tek istek olur; seçenekler arada da olabilir', () => {
    const a = parseArgs(['bu', '--mode', 'ask', 'dosyayı', 'açıkla', '-y']);
    expect(a.prompt).toBe('bu dosyayı açıkla');
    expect(a.mode).toBe('ask');
    expect(a.yes).toBe(true);
  });

  it('--ad=değer biçimi ve kısa adlar', () => {
    const a = parseArgs(['--model=gpt-5', '-C', '/tmp/proje', '-m', 'plan', 'x']);
    expect(a.model).toBe('gpt-5');
    expect(a.cwd).toBe('/tmp/proje');
    expect(a.mode).toBe('plan');
  });

  it('-- sonrası her şey istektir (tire ile başlasa da)', () => {
    expect(parseArgs(['--', '-y', 'nedir']).prompt).toBe('-y nedir');
  });

  it('tek başına "ayarlar" ayarları gösterir; cümle içinde istektir', () => {
    expect(parseArgs(['ayarlar']).showConfig).toBe(true);
    const a = parseArgs(['ayarlar', 'sayfasını', 'düzelt']);
    expect(a.showConfig).toBe(false);
    expect(a.prompt).toBe('ayarlar sayfasını düzelt');
  });

  it('hatalı kullanım okunur hata verir', () => {
    expect(() => parseArgs(['--mode', 'yaz'])).toThrow(/Geçersiz mod/);
    expect(() => parseArgs(['--model'])).toThrow(/değer ister/);
    expect(() => parseArgs(['--bilinmeyen'])).toThrow(/Bilinmeyen seçenek/);
  });
});
