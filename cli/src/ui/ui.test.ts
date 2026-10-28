import { describe, expect, it } from 'vitest';
import { matchFiles } from '../files';
import { MarkdownStream } from './markdown';
import { box, fit, fitStart, truncateAnsi, width, wrapPlain } from './theme';

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

  it('wrapPlain genişliğe böler', () => {
    expect(wrapPlain('abcdef', 4)).toEqual(['abcd', 'ef']);
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
