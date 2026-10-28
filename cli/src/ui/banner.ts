import * as os from 'os';
import * as path from 'path';
import type { AgentMode } from '../../../src/services/types';
import { BRAND, MODE_COLOR, MODE_LABEL, bold, box, c, columns, dim, fg, fitStart, gradient } from './theme';

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

export interface BannerInfo {
  version: string;
  root: string;
  provider: string;
  model: string;
  mode: AgentMode;
  autoApprove?: boolean;
}

/** Açılış ekranı: degrade logo + "Code CLI" + bilgi kutusu + ipuçları. */
export function banner(info: BannerInfo): string[] {
  const cols = columns();
  const out: string[] = [''];
  const rows = logoRows('TULVEZ');
  const logoWidth = rows[0].length;

  if (cols >= logoWidth + 20) {
    const side = [
      '',
      bold(gradient('C O D E', BRAND.slice(1))),
      bold(c.text('C L I')),
      dim(c.muted(`v${info.version}`)),
      '',
      '',
    ];
    rows.forEach((row, i) => out.push(`  ${gradient(row, BRAND, 0, logoWidth + 10)}   ${side[i]}`));
  } else {
    out.push(`  ${bold(gradient('◆ TULVEZ CODE CLI', BRAND))} ${dim(c.muted(`v${info.version}`))}`);
  }
  out.push('');

  const modeColor = fg(MODE_COLOR[info.mode]);
  const w = Math.min(cols - 2, 72);
  const label = (t: string): string => c.muted(t.padEnd(9));
  const lines = [
    `${gradient('✻', BRAND)} ${bold('Tulvez Code CLI')}${c.muted("'ya hoş geldin!")}`,
    '',
    `${label('Klasör')}${c.text(fitStart(shortPath(info.root), w - 4 - 9))}`,
    `${label('Model')}${c.text(info.provider)}${c.muted(' · ')}${c.text(fitStart(info.model || 'varsayılan', w - 4 - 9 - info.provider.length - 3))}`,
    `${label('Mod')}${modeColor('●')} ${modeColor(MODE_LABEL[info.mode])}${info.autoApprove ? c.yellow('  » onaylar açık') : ''}`,
  ];
  for (const l of box(lines, { width: w, color: c.muted })) out.push(` ${l}`);
  out.push('');
  out.push(`  ${c.muted('İpuçları:')} ${c.text('/')}${c.muted(' komutlar · ')}${c.text('@')}${c.muted(' dosya ekle · ')}${c.text('⇧Tab')}${c.muted(' mod · ')}${c.text('Esc')}${c.muted(' durdur · ')}${c.text('\\⏎')}${c.muted(' yeni satır')}`);
  out.push('');
  return out;
}
