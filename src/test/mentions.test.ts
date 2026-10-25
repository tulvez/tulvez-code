import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mentionMenu, mentionQuery } from '../../webview/src/lib/slashMenu';

const { findMentions, mentionContext } = await import('../services/mentions');

let ws = '';
let outside = '';
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-at-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-at-out-'));
  fs.mkdirSync(path.join(ws, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src', 'app.ts'), 'export const app = 1;\n');
  fs.writeFileSync(path.join(ws, 'README.md'), '# Proje\n');
  fs.writeFileSync(path.join(outside, 'gizli.txt'), 'GIZLI');
});

describe('@dosya', () => {
  it('mesajdaki @yolları bulur; e-posta ve tekrarları atlar', () => {
    expect(findMentions('@src/app.ts ile @README.md dosyasına bak, mail a@b.com, yine @src/app.ts')).toEqual(['src/app.ts', 'README.md']);
    expect(findMentions('@src\\lib\\ klasörü')).toEqual(['src/lib']);
  });

  it('dosya içeriği ve klasör listesi mesaja eklenir', async () => {
    const ctx = await mentionContext('@src/app.ts ve @src/ ne yapıyor?', ws);
    expect(ctx).toContain('<dosya yol="src/app.ts">\nexport const app = 1;');
    expect(ctx).toContain('<klasör yol="src/">\nlib/\napp.ts');
  });

  it('olmayan yol, @kişi ve çalışma alanı dışı eklenmez', async () => {
    fs.symlinkSync(outside, path.join(ws, 'bag'), 'dir');
    const rel = path.relative(ws, path.join(outside, 'gizli.txt'));
    expect(await mentionContext(`@yok.ts @ahmet @${rel} @bag/gizli.txt`, ws)).toBe('');
    expect(await mentionContext('@src/app.ts', undefined)).toBe('');
  });

  it('büyük dosya kısaltılır', async () => {
    fs.writeFileSync(path.join(ws, 'buyuk.txt'), 'a'.repeat(50_000));
    const ctx = await mentionContext('@buyuk.txt', ws);
    expect(ctx).toContain('kısaltıldı');
    expect(ctx.length).toBeLessThan(21_000);
  });
});

describe('@ menüsü', () => {
  it('yalnız sondaki @yazı arama sayılır', () => {
    expect(mentionQuery('şuna bak @sr')).toBe('sr');
    expect(mentionQuery('@')).toBe('');
    expect(mentionQuery('a@b.com')).toBeNull();
    expect(mentionQuery('@src/app.ts ')).toBeNull();
  });

  it('seçilen dosya yazının yerine geçer', () => {
    const m = mentionMenu('şuna bak @ap', ['src/app.ts']);
    expect(m?.items[0]).toEqual({ label: 'src/app.ts', hint: '', insert: 'şuna bak @src/app.ts ' });
    expect(mentionMenu('@x', null)?.items[0]).toMatchObject({ label: 'Aranıyor…', disabled: true });
    expect(mentionMenu('@x', [])?.items[0]).toMatchObject({ label: 'Eşleşen dosya yok', disabled: true });
  });
});
