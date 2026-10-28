import { describe, expect, it } from 'vitest';
import { matchFiles } from '../files';
import { normalizePaste } from './clipboard';
import { diffSummary, lineDiff } from './diff';
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

describe('düzenleme farkı', () => {
  it('tek bölge değişimi: eklenen/silinen satırlar ve başlangıç satırı', () => {
    const d = lineDiff('a\nb\nc\nd\n', 'a\nB\nB2\nd\n');
    expect(d).toMatchObject({ added: 2, removed: 2, start: 2, removedLines: ['b', 'c'], addedLines: ['B', 'B2'] });
    expect(diffSummary(d)).toBe('2 satır eklendi, 2 satır silindi');
  });
  it('yeni dosya: sondaki satır sonu boş satır sayılmaz', () => {
    expect(lineDiff('', 'selam dunya\n')).toMatchObject({ added: 1, removed: 0, addedLines: ['selam dunya'] });
  });
  it('değişiklik yoksa özet söyler; Windows satır sonu fark sayılmaz', () => {
    expect(diffSummary(lineDiff('x\r\ny\r\n', 'x\ny\n'))).toBe('değişiklik yok');
  });
});

describe('akan satırın önizlemesi', () => {
  it('yarım satır gösterilir ama yazılmaz; satır bitince yazılır', () => {
    const out: string[] = [];
    const md = new MarkdownStream((l) => out.push(l));
    md.push('Merhaba `dün');
    expect(md.peek()).toBe('● Merhaba `dün');
    expect(out).toEqual([]);
    md.push('ya`\n');
    expect(out).toEqual(['● Merhaba dünya']);
    expect(md.peek()).toBeNull();
    md.push('ikinci');
    expect(md.peek()).toBe('  ikinci');
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
  it('istek çok büyük: hız sınırı sanılmaz, sınır ve istek boyutu yazılır', () => {
    const e = friendlyError('Request too large for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 13194, please reduce your message size and try again.');
    expect(e.title).toBe('İstek çok büyük');
    expect(e.lines.join(' ')).toContain('Sınır 8.000 token, istek 13.194 token');
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

describe('tuş çevirici (pi-tui girdisi → bileşen tuşları)', async () => {
  const { toKeys } = await import('./keys');
  it('harfler, Türkçe harfler ve hızlı yazım tek tek gelir', () => {
    expect(toKeys('a')).toEqual([['a', expect.objectContaining({ name: 'a' })]]);
    expect(toKeys('çğ').map(([ch]) => ch)).toEqual(['ç', 'ğ']);
  });
  it('özel tuşlar ve değiştiriciler', () => {
    expect(toKeys('\r')[0][1]).toMatchObject({ name: 'return' });
    expect(toKeys('\x03')[0][1]).toMatchObject({ name: 'c', ctrl: true });
    expect(toKeys('\x1b[Z')[0][1]).toMatchObject({ name: 'tab', shift: true });
    expect(toKeys('\x1b[1;5A')[0][1]).toMatchObject({ name: 'up', ctrl: true });
    expect(toKeys('\x1b[5~')[0][1]).toMatchObject({ name: 'pageup' });
    expect(toKeys('\x1b')[0][1]).toMatchObject({ name: 'escape' });
  });
  it('yapıştırma tek parça gelir, içindeki Enter gönderme sayılmaz', () => {
    expect(toKeys('\x1b[200~bir\riki\x1b[201~')).toEqual([[undefined, { name: 'paste', sequence: 'bir\riki' }]]);
  });
});
