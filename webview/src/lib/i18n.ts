/**
 * Arayüz dili. Eklenti HTML'e <body data-lang="tr|en"> yazar (ayar tulvez.language; "auto" ise
 * VS Code'un dili). Dil değişince eklenti paneli yeniden yükler, bu yüzden değer çalışma boyunca sabittir.
 * Metinler kaynakta yan yana durur: L('Türkçe', 'English').
 */
export type Lang = 'tr' | 'en';

// globalThis üzerinden: dosya testlerde (DOM'suz Node) de içe aktarılır, orada Türkçe kalır
const doc = (globalThis as { document?: { body?: { dataset?: Record<string, string | undefined> } } }).document;
export const LANG: Lang = doc?.body?.dataset?.lang === 'en' ? 'en' : 'tr';

export const L = (tr: string, en: string): string => (LANG === 'en' ? en : tr);

/** Sayı ve tarih biçimi */
export const LOCALE = LANG === 'en' ? 'en-US' : 'tr-TR';
