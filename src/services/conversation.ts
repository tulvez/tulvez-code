import type { ModelMessage } from 'ai';

/**
 * Sohbet hafızası: her sohbetin modele giden tam konuşması (araç çağrıları ve sonuçları dahil).
 *
 * Arayüz yalnız düz metin geçmişi tutar; onunla devam eden ajan bir önceki turda okuduğu dosyaları
 * ve komut çıktılarını görmez. Burada tutulan konuşma, sohbet kimliği ve tur sayısı uyuyorsa
 * kullanılır; uymuyorsa (VS Code yeniden açıldı, yeniden deneme, yarıda kesilen tur) düz metne düşülür.
 * Yalnız bellekte durur, diske yazılmaz.
 */

interface Entry { messages: ModelMessage[]; turns: number }

const MAX_SESSIONS = 20;
const store = new Map<string, Entry>();

/** `turns`: bu mesajdan önce sohbette kaç kullanıcı mesajı var. */
export function getConversation(sessionId: string | undefined, turns: number): ModelMessage[] | null {
  if (!sessionId) return null;
  const entry = store.get(sessionId);
  return entry && entry.turns === turns ? entry.messages : null;
}

export function saveConversation(sessionId: string | undefined, turns: number, messages: ModelMessage[]): void {
  if (!sessionId) return;
  store.delete(sessionId);
  store.set(sessionId, { messages, turns });
  while (store.size > MAX_SESSIONS) store.delete(store.keys().next().value as string);
}

export function dropConversation(sessionId: string | undefined): void {
  if (sessionId) store.delete(sessionId);
}

/** Düşünme (reasoning) parçaları geri gönderilmez: bazı uç noktalar reddeder, bağlamı da boşa harcar. */
export function withoutReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || typeof m.content === 'string') return m;
    return { ...m, content: m.content.filter((p) => p.type === 'text' || p.type === 'tool-call') };
  });
}

const sizeOf = (m: ModelMessage): number => JSON.stringify(m.content).length;

const KEEP_HEAD = 300;

function shortenToolMessage(m: ModelMessage): ModelMessage {
  if (m.role !== 'tool') return m;
  return {
    ...m,
    content: m.content.map((part) => {
      if (part.type !== 'tool-result') return part;
      const out = part.output;
      if ((out.type === 'text' || out.type === 'error-text') && out.value.length > KEEP_HEAD * 2) {
        return {
          ...part,
          output: { ...out, value: `${out.value.slice(0, KEEP_HEAD)}\n… (eski araç çıktısı, ${out.value.length} karakterdi; yer açmak için kısaltıldı — gerekirse aracı yeniden çalıştır)` },
        };
      }
      return part;
    }),
  };
}

/**
 * Konuşmayı karakter bütçesine sığdırır. Son iki tur hiç değişmez. Önce eski araç çıktıları
 * kısaltılır, yetmezse en eski turlar bütünüyle atılır (araç çağrısı ile sonucu birlikte gider,
 * yarım çift kalmaz).
 */
export function compactConversation(messages: ModelMessage[], budgetChars: number): ModelMessage[] {
  let total = messages.reduce((n, m) => n + sizeOf(m), 0);
  if (total <= budgetChars) return messages;

  const userIdx = messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
  const protectFrom = userIdx.length >= 2 ? userIdx[userIdx.length - 2] : 0;

  let out = messages.slice();
  for (let i = 0; i < protectFrom && total > budgetChars; i++) {
    const before = sizeOf(out[i]);
    out[i] = shortenToolMessage(out[i]);
    total -= before - sizeOf(out[i]);
  }

  // Tur başları: kullanıcı mesajları. İlk korunan tura kadar en eskiden başlayarak at.
  while (total > budgetChars) {
    const starts = out.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
    if (starts.length <= 2) break;
    const cut = starts[1];
    total -= out.slice(0, cut).reduce((n, m) => n + sizeOf(m), 0);
    out = out.slice(cut);
  }
  return out;
}

const FIT_FLOOR = 800;

/**
 * Sağlayıcının istek başına token sınırına (ör. Groq ücretsiz planında dakikada 8.000) sığmak için
 * araç çıktılarını, en büyüğünden başlayarak baştan ve sondan kısaltır. Bu turunkiler de dahil:
 * sınır aşılırsa istek hiç gitmez. Mesaj sırası ve araç çağrısı/sonuç çiftleri bozulmaz.
 */
export function fitToolResults(messages: ModelMessage[], budgetChars: number): ModelMessage[] {
  let total = messages.reduce((n, m) => n + sizeOf(m), 0);
  if (total <= budgetChars) return messages;
  const out = messages.map((m) => (m.role === 'tool' ? { ...m, content: m.content.slice() } : m));
  for (let guard = 0; guard < 200 && total > budgetChars; guard++) {
    // En büyük metin çıktısı
    let best: { mi: number; pi: number; len: number } | null = null;
    out.forEach((m, mi) => {
      if (m.role !== 'tool') return;
      m.content.forEach((p, pi) => {
        if (p.type !== 'tool-result') return;
        const o = p.output;
        if ((o.type === 'text' || o.type === 'error-text') && o.value.length > FIT_FLOOR && (!best || o.value.length > best.len)) {
          best = { mi, pi, len: o.value.length };
        }
      });
    });
    if (!best) break;
    const { mi, pi, len } = best;
    const msg = out[mi] as Extract<ModelMessage, { role: 'tool' }>;
    const part = msg.content[pi] as Extract<(typeof msg.content)[number], { type: 'tool-result' }>;
    const value = (part.output as { value: string }).value;
    const keep = Math.max(FIT_FLOOR, Math.min(Math.floor(len / 2), len - (total - budgetChars)));
    const head = Math.floor(keep * 0.7);
    const shortened = `${value.slice(0, head)}\n… (${len - keep} karakter sağlayıcının istek sınırı yüzünden atlandı; gerekirse grep_files ile ilgili yeri ara) …\n${value.slice(len - (keep - head))}`;
    msg.content[pi] = { ...part, output: { ...(part.output as { type: 'text' }), value: shortened } };
    total -= len - shortened.length;
  }
  return out;
}
