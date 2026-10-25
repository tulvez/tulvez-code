import * as vscode from 'vscode';

/**
 * Eklentinin dili: tulvez.language ("auto" | "tr" | "en"). "auto" VS Code'un arayüz dilini izler:
 * Türkçe ise Türkçe, değilse İngilizce. Kullanıcıya görünen bildirim ve hata metinleri L('…', '…') ile yazılır.
 */
export type Lang = 'tr' | 'en';

export function currentLang(): Lang {
  const set = vscode.workspace.getConfiguration('tulvez').get<string>('language', 'auto');
  if (set === 'tr' || set === 'en') return set;
  let ui: string | undefined;
  try { ui = vscode.env?.language; } catch { /* testlerdeki sahte vscode modülünde env yok */ }
  if (!ui) return 'tr';
  return ui.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export const L = (tr: string, en: string): string => (currentLang() === 'en' ? en : tr);
