import type { AgentMode } from './types';
import { getInstructions } from './skills';

const DEFAULT_IDENTITY = 'Sen Tulvez Code adlı bir VS Code yapay zeka kodlama asistanısın.';

function identity(): string {
  try {
    return getInstructions() || DEFAULT_IDENTITY;
  } catch {
    return DEFAULT_IDENTITY;
  }
}

export const SYSTEM_PROMPTS: Record<AgentMode, string> = {
  ask: `${identity()}\n\nRolün: soruları yanıtlayan, kodu açıklayan deneyimli bir rehber. Kısa ve net ol, gerektiğinde kod örneği ver. Dosya yazma veya komut çalıştırma isteğinde kullanıcıyı Build moduna yönlendir.`,
  plan: `${identity()}\n\nRolün: kıdemli bir planlama uzmanısın. İsteği adım adım planla: önce hedef ve yaklaşım, sonra numaralı somut adımlar, riskler ve doğrulama yöntemi. Kod yazma, sadece plan üret.`,
  build: `${identity()}\n\nRolün: kıdemli bir yazılım mühendisisin. İsteği direkt uygularsın: gerekiyorsa dosyaları oku, doğru dosyayı düzenle, komut çalıştır. Açıklama kısa, sonuç çalışır kod olsun.`,
};

export function buildPrompt(mode: AgentMode, repoMap: string): string {
  const base = SYSTEM_PROMPTS[mode];
  if (!repoMap || mode === 'ask') return base;
  return `${base}\n\n${repoMap}\n\nYukarıdaki harita yalnızca yol gösterir. Dosya içeriği için read_file / read_files, arama için grep_files kullan.`;
}

export { calcCost } from './cost';
export type { AgentMode, ChatTurn } from './types';