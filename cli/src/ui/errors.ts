/**
 * Sağlayıcı hatalarını kullanıcının anlayacağı Türkçeye çevirir; ne yapılacağını söyler.
 * Tanınmayan hata olduğu gibi döner.
 */
export interface FriendlyError {
  title: string;
  lines: string[];
  /** Özgün ileti (kısaltılmış), ayrıntı olarak */
  detail?: string;
}

function seconds(raw: string): number | null {
  const m = /try again in\s+(?:(\d+)m)?([\d.]+)s/i.exec(raw) ?? /retry[- ]after[^\d]*(\d+)/i.exec(raw);
  if (!m) return null;
  const mins = m.length > 2 && m[1] ? Number(m[1]) : 0;
  return Math.ceil(mins * 60 + Number(m[m.length - 1]));
}

export function friendlyError(raw: string): FriendlyError {
  // SDK'nın yeniden deneme öneki ("Failed after 3 attempts. Last error: …") ayrıntıda gereksiz
  const text = raw.trim().replace(/^Failed after \d+ attempts\. Last error:\s*(?:AI_\w+:\s*)?/i, '');
  const detail = text.length > 240 ? `${text.slice(0, 240)}…` : text;
  const low = text.toLowerCase();

  // Kota: yalnız gerçek kota ifadeleri ("billing" kelimesi hız sınırı iletilerindeki bağlantıda da geçer)
  if (low.includes('exceeded your current quota') || low.includes('insufficient_quota') || low.includes('credit balance is too low')) {
    return {
      title: 'Hesabın kotası ya da bakiyesi bitti',
      lines: ['Sağlayıcının panelinden bakiye ya da plan durumunu kontrol et.', 'Başka bir sağlayıcıya geçmek için /provider.'],
      detail,
    };
  }
  // İstek sınırı (Groq'ta "Request too large … on tokens per minute"): bekleyince geçmez, küçültmek gerekir
  if (/request too large|reduce your message size|context[_ ]length|maximum context length|prompt is too long/.test(low)) {
    const limit = /limit\s*:?\s*(\d+)/i.exec(text);
    const asked = /requested\s*:?\s*(\d+)/i.exec(text);
    const lines = ['İstek bu modelin tek seferde kabul ettiğinden büyük; Tulvez Code araç çıktılarını kısaltıp yeniden denedi ama sığmadı.'];
    if (limit) lines.push(`Sınır ${Number(limit[1]).toLocaleString('tr-TR')} token${asked ? `, istek ${Number(asked[1]).toLocaleString('tr-TR')} token` : ''}.`);
    lines.push('/clear ile yeni sohbet aç, daha küçük bir iş iste ya da /model veya /provider ile sınırı yüksek bir model seç.');
    return { title: 'İstek çok büyük', lines, detail };
  }
  if (low.includes('rate limit') || low.includes('rate_limit') || /\b429\b/.test(low) || low.includes('too many requests')) {
    const lines = ['Sağlayıcının hız sınırına takıldın; Tulvez Code birkaç kez bekleyip yeniden denedi.'];
    const limit = /limit\s+(\d+)/i.exec(text);
    if (limit && /tokens per minute|tpm/i.test(text)) lines.push(`Bu hesabın sınırı dakikada ${Number(limit[1]).toLocaleString('tr-TR')} token.`);
    const s = seconds(text);
    lines.push(s ? `Yaklaşık ${s} sn sonra yeniden dene.` : 'Biraz bekleyip yeniden dene.');
    lines.push('Daha az token için /clear ile yeni sohbet aç ya da /model ile daha küçük bir model seç.');
    return { title: 'Hız sınırı', lines, detail };
  }
  if (/\b401\b/.test(low) || low.includes('invalid api key') || low.includes('incorrect api key') || low.includes('invalid x-api-key') || low.includes('unauthorized') || low.includes('authentication')) {
    return { title: 'API anahtarı geçersiz', lines: ['Anahtarı /provider ile yeniden gir.'], detail };
  }
  if ((/\b404\b/.test(low) && low.includes('model')) || low.includes('model_not_found') || low.includes('does not exist')) {
    return { title: 'Model bulunamadı', lines: ['Bu sağlayıcıda olan bir modeli /model ile seç.'], detail };
  }
  if (low.includes('fetch failed') || low.includes('enotfound') || low.includes('econnrefused') || low.includes('etimedout') || low.includes('econnreset') || low.includes('socket hang up')) {
    return { title: 'Sağlayıcıya ulaşılamadı', lines: ['İnternet bağlantını ya da adres ayarını (/config) kontrol et; sonra yeniden dene.'], detail };
  }
  return { title: 'Hata', lines: [detail] };
}
