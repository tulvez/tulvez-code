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
  title: string;
  items: SlashEntry[];
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
      .map((s) => ({ label: s.name, hint: s.description, insert: `/skill ${s.name} ` }));
    if (items.length === 0) {
      items.push({
        label: skills.length ? 'Eşleşen beceri yok' : 'Kurulu beceri yok',
        hint: skills.length ? '' : 'Ayarlar → Skills',
        insert: input,
        disabled: true,
      });
    }
    return { title: 'Beceriler', items };
  }

  if (/\s/.test(input)) return null;
  const q = input.toLowerCase();
  const items: SlashEntry[] = commands
    .filter((c) => c.cmd.startsWith(q))
    .map((c) => ({ label: c.cmd, hint: c.hint, insert: `${c.cmd} ` }));
  return items.length ? { title: 'Komutlar', items } : null;
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
    ? [{ label: 'Aranıyor…', hint: '', insert: input, disabled: true }]
    : files.map((f) => ({ label: f, hint: '', insert: `${head}@${f} ` }));
  if (files !== null && items.length === 0) items.push({ label: 'Eşleşen dosya yok', hint: '', insert: input, disabled: true });
  return { title: 'Dosyalar', items };
}
