/**
 * Sağlayıcı isteklerinde hız sınırı (429) beklemesi. Sağlayıcı "X sn sonra dene" derse (retry-after
 * başlığı ya da iletideki "try again in Xs", 60 sn'ye kadar) istek o kadar beklenip yinelenir;
 * bekleme dinleyiciye bildirilir (arayüz "18 sn bekleniyor" gösterir). Böylece hata yalnız
 * başarısız isteği etkiler: ajanın önceki araç adımları yeniden çalışmaz.
 */

export type RateLimitListener = (seconds: number) => void;

const MAX_WAITS = 3;
const MAX_WAIT_SECONDS = 60;

let listener: RateLimitListener | null = null;

/** Bekleme bildirimi; dönen işlev dinleyiciyi kaldırır. */
export function onRateLimitWait(fn: RateLimitListener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** retry-after-ms / retry-after başlığı ya da ileti gövdesindeki "try again in 1m2.5s". */
export function retryAfterSeconds(headers: Headers, body = ''): number | null {
  const ms = Number(headers.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms / 1000;
  const ra = headers.get('retry-after');
  if (ra !== null && ra.trim() !== '') {
    const s = Number(ra);
    if (Number.isFinite(s)) return Math.max(0, s);
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
  }
  const m = /try again in\s+(?:(\d+)m)?([\d.]+)s/i.exec(body);
  if (m) return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
  return null;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Sağlayıcılara verilen fetch: 429'da bekleyip yineler, diğer yanıtları olduğu gibi döndürür. */
export const rateLimitedFetch: typeof fetch = async (input, init) => {
  for (let wait = 0; ; wait++) {
    const res = await fetch(input, init);
    if (res.status !== 429 || wait >= MAX_WAITS) return res;
    const body = await res.clone().text().catch(() => '');
    const seconds = retryAfterSeconds(res.headers, body);
    if (seconds === null || seconds > MAX_WAIT_SECONDS) return res;
    listener?.(Math.ceil(seconds));
    await sleep(seconds * 1000 + 250, init?.signal);
  }
};
