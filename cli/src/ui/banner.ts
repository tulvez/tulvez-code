import * as os from 'os';
import * as path from 'path';
import type { AgentMode } from '../../../src/services/types';
import { BRAND, MODE_COLOR, MODE_LABEL, bold, c, dim, fg, fitStart, gradient, width } from './theme';

// "ANSI Shadow" biçiminde TULVEZ; her harf 6 satır
const LETTERS: Record<string, string[]> = {
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  V: ['██╗   ██╗', '██║   ██║', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚═══╝  '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  Z: ['███████╗', '╚══███╔╝', '  ███╔╝ ', ' ███╔╝  ', '███████╗', '╚══════╝'],
};

function logoRows(word: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((r) => [...word].map((ch) => LETTERS[ch][r]).join(''));
}

/** Klasör yolu ev dizinine göre kısaltılır (~/proje). */
export function shortPath(p: string): string {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return `~${path.sep}${path.relative(home, p)}`;
  return p;
}

export interface WelcomeInfo {
  version: string;
  root: string;
  provider: string;
  model: string;
  mode: AgentMode;
  /** Kurulum sürüyorsa örnekler ve kısayollar gösterilmez */
  setup?: boolean;
}

const EXAMPLES = [
  'Bu depo ne yapıyor? Kısaca anlat',
  '@README.md dosyasını gözden geçir, eksikleri söyle',
  'Testleri çalıştır, kırılanları düzelt',
];

function center(lines: string[], w: number): string[] {
  return lines.map((l) => `${' '.repeat(Math.max(0, Math.floor((w - width(l)) / 2)))}${l}`);
}

/** Boş sohbetin ekranı: ortada logo, örnek istekler, klasör/model ve kısayollar. */
export function welcomeView(info: WelcomeInfo): (w: number, h: number) => string[] {
  return (w, h) => {
    const out: string[] = [];
    const rows = logoRows('TULVEZ');
    const logoW = rows[0].length;
    const tall = h >= 18;

    if (w >= logoW + 16 && tall) {
      const side = ['', bold(gradient('C O D E', BRAND.slice(1))), bold(c.text('C L I')), dim(c.muted(`v${info.version}`)), '', ''];
      const block = rows.map((row, i) => `${gradient(row, BRAND, 0, logoW + 10)}   ${side[i]}`);
      // Logo blok olarak ortalanır (satırlar aynı soldan başlar)
      const pad = ' '.repeat(Math.max(0, Math.floor((w - logoW - 10) / 2)));
      out.push(...block.map((l) => `${pad}${l}`));
    } else {
      out.push(...center([`${bold(gradient('◆ TULVEZ CODE CLI', BRAND))} ${dim(c.muted(`v${info.version}`))}`], w));
    }
    if (info.setup) return out;

    out.push('');
    const m = fg(MODE_COLOR[info.mode]);
    const meta = `${c.muted(fitStart(shortPath(info.root), Math.max(12, w - 50)))}${c.muted('  ·  ')}${c.text(info.provider)}${c.muted(' · ')}${c.text(info.model || 'varsayılan')}${c.muted('  ·  ')}${m('●')} ${m(MODE_LABEL[info.mode])}`;
    out.push(...center([meta], w));
    if (h >= 22) {
      out.push('');
      const ex = [c.muted('Şunları deneyebilirsin'), ...EXAMPLES.map((e) => `${c.brand('›')} ${c.text(e)}`)];
      const exW = Math.max(...ex.map(width));
      const pad = ' '.repeat(Math.max(0, Math.floor((w - exW) / 2)));
      out.push(...ex.map((l) => `${pad}${l}`));
    }
    out.push('');
    const keys = [['/', 'komutlar'], ['@', 'dosya ekle'], ['⇧Tab', 'mod'], ['Esc', 'durdur'], ['PgUp', 'kaydır']]
      .map(([k, v]) => `${c.text(k)} ${c.muted(v)}`).join(c.muted('  ·  '));
    out.push(...center([keys], w));
    return out;
  };
}
