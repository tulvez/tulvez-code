/**
 * Giriş kutusundaki "/" menüsü: yazılan metne göre komut ya da beceri listesi.
 *
 *   "/"  "/re"            → komutlar (başı eşleşenler)
 *   "/skill" "/skill sc"  → kurulu beceriler (adı ya da açıklaması eşleşenler)
 *   "/skill ad " (boşlukla) → menü kapanır, kullanıcı isteğini yazar
 */

export interface SlashCommand { cmd: string; hint: string }
export interface SkillItem { name: string; description: string }

export interface SlashEntry {
  label: string;
  hint: string;
  /** Seçilince giriş kutusuna yazılacak metin */
  insert: string;
  disabled?: boolean;
}

export interface SlashMenu {
  /** Hangi menü (başlık dile göre değişir, karşılaştırma bununla yapılır) */
  kind: 'commands' | 'skills' | 'files';
  title: string;
  items: SlashEntry[];
}

import { L } from './i18n';

/** Beceri açıklamalarının gösterim sınırı: satırlar hep aynı yükseklikte (2 satır) görünsün */
export const ACIKLAMA_SINIRI = 100;

/** Açıklamayı sınırda kelime ortasından bölmeden kısaltır; tamamı ipucunda (title) kalır. */
export function kisaAciklama(text: string, sinir = ACIKLAMA_SINIRI): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= sinir) return t;
  const cut = t.slice(0, sinir - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > sinir * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.·—-]+$/, '')}…`;
}

const SKILL_RE = /^\/skills?(?:\s+(\S*))?$/i;

export function slashMenu(input: string, commands: SlashCommand[], skills: SkillItem[]): SlashMenu | null {
  if (!input.startsWith('/')) return null;

  const sk = SKILL_RE.exec(input);
  // "/skill" tek başına hem komut hem beceri listesidir: beceriler gösterilir
  if (sk && (sk[1] !== undefined || /^\/skills?$/i.test(input))) {
    const q = (sk[1] ?? '').toLowerCase();
    const items: SlashEntry[] = skills
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
      .map((s) => ({ label: s.name, hint: kisaAciklama(s.description), insert: `/skill ${s.name} ` }));
    if (items.length === 0) {
      items.push({
        label: skills.length ? L('Eşleşen beceri yok', 'No matching skill') : L('Kurulu beceri yok', 'No skills installed'),
        hint: skills.length ? '' : L('Ayarlar → Skills', 'Settings → Skills'),
        insert: input,
        disabled: true,
      });
    }
    return { kind: 'skills', title: L('Beceriler', 'Skills'), items };
  }

  if (/\s/.test(input)) return null;
  const q = input.toLowerCase();
  const items: SlashEntry[] = commands
    .filter((c) => c.cmd.startsWith(q))
    .map((c) => ({ label: c.cmd, hint: c.hint, insert: `${c.cmd} ` }));
  return items.length ? { kind: 'commands', title: L('Komutlar', 'Commands'), items } : null;
}

/** Giriş sonundaki "@yarım" yazı: dosya menüsünün arama metni; yoksa null. */
export function mentionQuery(input: string): string | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(input);
  return m ? m[1] : null;
}

/**
 * "@" menüsü: eklentiden gelen dosya listesi. `files` null ise arama sürüyor.
 * Seçilen dosya "@yol " olarak yazılır; gönderilince içeriği mesaja eklenir.
 */
export function mentionMenu(input: string, files: string[] | null): SlashMenu | null {
  const q = mentionQuery(input);
  if (q === null) return null;
  const head = input.slice(0, input.length - q.length - 1);
  const items: SlashEntry[] = files === null
    ? [{ label: L('Aranıyor…', 'Searching…'), hint: '', insert: input, disabled: true }]
    : files.map((f) => ({ label: f, hint: '', insert: `${head}@${f} ` }));
  if (files !== null && items.length === 0) items.push({ label: L('Eşleşen dosya yok', 'No matching file'), hint: '', insert: input, disabled: true });
  return { kind: 'files', title: L('Dosyalar', 'Files'), items };
}
