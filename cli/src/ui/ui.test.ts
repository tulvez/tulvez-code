import { describe, expect, it } from 'vitest';
import { matchFiles } from '../files';
import { normalizePaste } from './clipboard';
import { friendlyError } from './errors';
import { MarkdownStream } from './markdown';
import { box, fit, fitStart, truncateAnsi, width, wrapAnsi, wrapPlain } from './theme';

// Testlerde stdout terminal değil: renkler kapalı, çıktı düz metin.
const render = (chunks: string[]): string[] => {
  const out: string[] = [];
  const md = new MarkdownStream((l) => out.push(l));
  for (const ch of chunks) md.push(ch);
  md.flush();
  return out;
};

describe('markdown akışı', () => {
  it('parçalı gelen satırları birleştirir; ilk satır ● ile başlar', () => {
    expect(render(['Mer', 'haba\nikin', 'ci satır'])).toEqual(['● Merhaba', '  ikinci satır']);
  });

  it('baştaki boş satırlar atlanır', () => {
    expect(render(['\n\nSelam'])).toEqual(['● Selam']);
  });

  it('başlık, liste, numaralı liste, alıntı, görev', () => {
    const out = render(['# Başlık\n- bir\n2. iki\n> not\n- [x] bitti\n- [ ] sırada\n']);
    expect(out).toEqual(['● Başlık', '  • bir', '  2. iki', '  ▎ not', '  ✓ bitti', '  ○ sırada']);
  });

  it('kod bloğu çerçevelenir, içi biçimlenmez', () => {
    const out = render(['```ts\nconst a = **b**;\n```\n']);
    expect(out).toEqual(['● ╭─ ts', '  │ const a = **b**;', '  ╰─']);
  });

  it('satır içi: `kod` ve **kalın** işaretleri kalkar, bağlantı adresi yanında', () => {
    expect(render(['`npm ci` ve **önemli** [site](https://tulvez.com)'])).toEqual(['● npm ci ve önemli site (https://tulvez.com)']);
  });

  it('reset yeni blok açar', () => {
    const out: string[] = [];
    const md = new MarkdownStream((l) => out.push(l));
    md.push('a\n');
    md.reset();
    md.push('b');
    md.flush();
    expect(out).toEqual(['● a', '● b']);
  });
});

describe('ölçü yardımcıları', () => {
  it('Türkçe karakter 1, Doğu Asya ve emoji 2 sütun', () => {
    expect(width('çğış')).toBe(4);
    expect(width('漢字')).toBe(4);
    expect(width('\x1b[31mab\x1b[39m')).toBe(2);
  });

  it('fit doldurur ya da … ile keser; fitStart sonu korur', () => {
    expect(fit('abc', 5)).toBe('abc  ');
    expect(width(fit('abcdefgh', 5))).toBe(5);
    expect(fitStart('/uzun/bir/yol/proje', 8)).toBe('…l/proje');
    expect(fitStart('kısa', 8)).toBe('kısa');
  });

  it('truncateAnsi görünen genişliğe göre keser', () => {
    const t = truncateAnsi('abcdefghij', 6);
    expect(width(t)).toBe(6);
    expect(t.endsWith('…')).toBe(true);
  });

  it('kutu satırları taşmaz', () => {
    const lines = box(['x'.repeat(200)], { width: 40 });
    for (const l of lines) expect(width(l)).toBe(40);
  });

  it('wrapAnsi uzun satırı genişliğe böler, devam satırları girintili', () => {
    const text = 'aaaa bbbb cccc dddd eeee ffff';
    const rows = wrapAnsi(text, 12, 2);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(width(r)).toBeLessThanOrEqual(12);
    for (const r of rows.slice(1)) expect(r.startsWith('  ')).toBe(true);
    // İçerik kaybolmaz (satır başı boşluğu ve kırılan boşluk hariç)
    expect(rows.map((r, i) => (i ? r.slice(2) : r)).join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    expect(wrapAnsi('kısa', 10)).toEqual(['kısa']);
  });

  it('wrapPlain genişliğe böler', () => {
    expect(wrapPlain('abcdef', 4)).toEqual(['abcd', 'ef']);
  });
});

describe('anlaşılır hatalar', () => {
  it('Groq hız sınırı: dakikalık sınır ve bekleme süresi', () => {
    // Gerçek Groq iletisi (SDK önekiyle; sondaki billing bağlantısı kota sanılmamalı)
    const e = friendlyError('Failed after 3 attempts. Last error: AI_APICallError: Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 4920, Requested 5451. Please try again in 17.7825s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing');
    expect(e.title).toBe('Hız sınırı');
    expect(e.lines.join(' ')).toContain('dakikada 8.000 token');
    expect(e.lines.join(' ')).toContain('18 sn');
    expect(e.detail?.startsWith('Rate limit')).toBe(true);
  });
  it('geçersiz anahtar, kota, bağlantı, bilinmeyen', () => {
    expect(friendlyError('401 Unauthorized: invalid api key').title).toBe('API anahtarı geçersiz');
    expect(friendlyError('You exceeded your current quota').title).toMatch(/kota/);
    expect(friendlyError('fetch failed').title).toBe('Sağlayıcıya ulaşılamadı');
    expect(friendlyError('garip bir şey')).toEqual({ title: 'Hata', lines: ['garip bir şey'] });
  });
});

describe('pano yapıştırma', () => {
  it('Windows satır sonları ve sondaki satır sonu düzelir', () => {
    expect(normalizePaste('a\r\nb\r\n', false)).toBe('a\nb');
  });
  it('tek satırlı girişte (API anahtarı) satırlar birleşir, boşluklar kırpılır', () => {
    expect(normalizePaste('  sk-abc\r\n def \n', true)).toBe('sk-abcdef');
  });
});

describe('@ dosya önerileri', () => {
  const files = ['README.md', 'src/', 'src/app.ts', 'src/sunucu.ts', 'test/app.test.ts'];
  it('ad başta eşleşen önce, sonra içinde geçen', () => {
    expect(matchFiles(files, 'app')).toEqual(['src/app.ts', 'test/app.test.ts']);
    expect(matchFiles(files, 'src')[0]).toBe('src/');
  });
  it('boş sorguda kısa yollar önce', () => {
    expect(matchFiles(files, '', 2)).toEqual(['src/', 'README.md']);
  });
});
