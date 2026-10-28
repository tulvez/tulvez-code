import { host } from './host';

/**
 * Eklentinin dili: tulvez.language ("auto" | "tr" | "en"). "auto" ortamın arayüz dilini izler (eklentide
 * VS Code'un dili, CLI'da Türkçe): Türkçe ise Türkçe, değilse İngilizce. Çekirdek `vscode` içe aktarmaz;
 * dil host katmanından okunur (CLI de aynı çekirdeği kullanır). Kullanıcıya görünen bildirim ve hata metinleri L('…', '…') ile yazılır.
 */
export type Lang = 'tr' | 'en';

export function currentLang(): Lang {
  const set = host().setting<string>('language', 'auto');
  if (set === 'tr' || set === 'en') return set;
  let ui: string | undefined;
  try { ui = host().uiLanguage?.(); } catch { /* ortam dili okunamadı */ }
  if (!ui) return 'tr';
  return ui.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export const L = (tr: string, en: string): string => (currentLang() === 'en' ? en : tr);
