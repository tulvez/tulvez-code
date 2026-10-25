import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Kural: bilgileri hazırlanmamış sürüm yayınlanmaz. Aynı denetim yayın işinde (publish.yml)
 * çalışır; burada da koşar ki eksik bilgi daha etiket atılmadan görülsün.
 */
const KOK = path.resolve(__dirname, '..', '..');
const BETIK = path.join(KOK, 'scripts', 'surum-denetimi.mjs');

function calistir(kok: string, etiket?: string): { kod: number; cikti: string } {
  const r = cp.spawnSync(process.execPath, [path.join(kok, 'scripts', 'surum-denetimi.mjs'), ...(etiket ? [etiket] : [])], { encoding: 'utf8' });
  return { kod: r.status ?? -1, cikti: `${r.stdout}${r.stderr}` };
}

function kopya(degistir: (d: string) => void): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-surum-'));
  fs.mkdirSync(path.join(d, 'scripts'));
  fs.copyFileSync(BETIK, path.join(d, 'scripts', 'surum-denetimi.mjs'));
  for (const f of ['package.json', 'CHANGELOG.md', 'surumler.json']) fs.copyFileSync(path.join(KOK, f), path.join(d, f));
  degistir(d);
  return d;
}

const pkgSurum = (): string => JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8')).version;

describe('sürüm bilgisi denetimi', () => {
  it('depodaki sürümün bilgileri hazır', () => {
    const r = calistir(KOK, `v${pkgSurum()}`);
    expect(r.cikti).toContain('sürüm bilgileri hazır');
    expect(r.kod).toBe(0);
  });

  it('yeni sürüm surumler.json ve CHANGELOG\'a yazılmadan yayınlanmaz', () => {
    const d = kopya((dir) => {
      const p = path.join(dir, 'package.json');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/"version": "[^"]+"/, '"version": "9.9.9"'));
    });
    const r = calistir(d, 'v9.9.9');
    expect(r.kod).toBe(1);
    expect(r.cikti).toContain('"## 9.9.9" bölümü yok');
    expect(r.cikti).toContain('en üst kaydı 9.9.9 olmalı');
  });

  it('etiket ile package.json uyuşmazsa ya da alanlar eksikse durur', () => {
    const d = kopya((dir) => {
      const p = path.join(dir, 'surumler.json');
      const liste = JSON.parse(fs.readFileSync(p, 'utf8'));
      liste[0].ozet.en = 'kısa';
      liste[0].tur = 'yeni';
      liste[0].tarih = '25.10.2026';
      fs.writeFileSync(p, JSON.stringify(liste));
      fs.appendFileSync(path.join(dir, 'CHANGELOG.md'), '\n## Yayınlanmadı\n\n- x\n');
    });
    const r = calistir(d, 'v0.0.1');
    expect(r.kod).toBe(1);
    for (const parca of ['Etiket (v0.0.1)', 'ozet.en', '"tur"', '"tarih"', 'Yayınlanmadı']) expect(r.cikti).toContain(parca);
  });

  it('geliştirme sırasında "## Yayınlanmadı" bölümü serbest (etiketsiz denetim)', () => {
    const d = kopya((dir) => fs.appendFileSync(path.join(dir, 'CHANGELOG.md'), '\n## Yayınlanmadı\n\n- x\n'));
    expect(calistir(d).kod).toBe(0);
  });
});
