import * as fs from 'fs';
import * as path from 'path';
import { L } from './i18n';

/**
 * OpenCode (Console: kullandıkça öde · Go: aylık abonelik).
 *
 * Her model ailesi kendi biçimi ve adresiyle çağrılır: Claude → Anthropic Messages, GPT/Grok/Muse →
 * OpenAI Responses, Gemini → Google, açık modeller → OpenAI uyumlu chat. Hangi modelin hangi biçimle
 * çağrılacağını OpenCode'un da kullandığı açık katalog models.dev verir (Console ile Go arasında fark
 * olabilir, ör. qwen3.8-max). Katalog günde bir indirilir, yalnız OpenCode kısmı saklanır; yoksa
 * model adından tahmin edilir.
 *
 * Ücretsiz modeller (big-pickle, *-free) OpenCode'un kuralı gereği yalnız OpenCode uygulamasında
 * çalışır; başka araçtan istek "FreeUsageLimitError" (HTTP 429) döner. Tulvez Code bunları listede
 * göstermez, seçilmişse istek göndermeden açıklar ve hatayı tekrar denemez.
 */

export type OcPlan = 'console' | 'go';
export type OcFormat = 'anthropic' | 'openai' | 'google' | 'compatible';

export interface OcModel {
  id: string;
  format: OcFormat;
  api: string;
  free: boolean;
  /** 1M token başına dolar */
  cost?: { input: number; output: number };
}

export type OcCatalog = Record<OcPlan, Record<string, OcModel>>;

const KOK: Record<OcPlan, string> = {
  console: 'https://opencode.ai/inference',
  go: 'https://opencode.ai/inference/go',
};
const CATALOG_URL = 'https://models.dev/api.json';
const MODELS_DEV_ID: Record<OcPlan, string> = { console: 'opencode', go: 'opencode-go' };

export const DEFAULT_OPENCODE_MODEL = 'deepseek-v4.1-flash';

export const freeOnlyMessage = (): string => L(
  'Bu ücretsiz model yalnız OpenCode’un kendi uygulamasında çalışıyor (OpenCode’un kuralı: ücretsiz modeller başka araçlardan kullanılamaz). ' +
  'Tulvez Code’da kullanmak için ücretli bir OpenCode modeli seç (ör. deepseek-v4.1-flash), OpenCode Go aboneliğine geç ' +
  '(sağlayıcı: OpenCode Go) ya da ücretsiz seçenek olarak Google Gemini’nin ücretsiz katmanını veya Ollama’yı kullan.',
  'This free model only works in the OpenCode app itself (OpenCode’s rule: free models cannot be used from other tools). ' +
  'To use OpenCode in Tulvez Code, choose a paid OpenCode model (e.g. deepseek-v4.1-flash), subscribe to OpenCode Go ' +
  '(provider: OpenCode Go), or for a free option use Google Gemini’s free tier or Ollama.');

let catalog: OcCatalog | null = null;

export function setOpencodeCatalog(c: OcCatalog | null): void { catalog = c; }

/** Sunucunun "yalnız OpenCode'da" hatası mı? (ör. Free usage limit reached. Free models work in OpenCode…) */
export function isFreeOnlyError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('freeusagelimit') || m.includes('free models work in opencode') || m.includes('free usage limit reached');
}

/** Ad tahmini: katalog yoksa ya da modeli bilmiyorsa */
function guessFormat(id: string): OcFormat {
  if (/^claude-/.test(id)) return 'anthropic';
  if (/^(gpt-|grok-|muse-|o\d)/.test(id)) return 'openai';
  if (/^gemini-/.test(id)) return 'google';
  return 'compatible';
}

function apiFor(plan: OcPlan, format: OcFormat): string {
  if (format === 'anthropic') return `${KOK[plan]}/anthropic/v1`;
  if (format === 'google') return `${KOK[plan]}/google/v1beta`;
  return `${KOK[plan]}/openai/v1`;
}

export function isFreeModel(id: string, plan: OcPlan = 'console'): boolean {
  const known = catalog?.[plan]?.[id];
  if (known) return known.free;
  return id === 'big-pickle' || /-free$/.test(id);
}

export function routeFor(id: string, plan: OcPlan): OcModel {
  const known = catalog?.[plan]?.[id];
  if (known) return known;
  const format = guessFormat(id);
  return { id, format, api: apiFor(plan, format), free: isFreeModel(id, plan) };
}

/** models.dev çıktısından yalnız OpenCode (Console ve Go) modelleri. */
export function parseModelsDev(json: unknown): OcCatalog | null {
  if (!json || typeof json !== 'object') return null;
  const out = { console: {}, go: {} } as OcCatalog;
  for (const plan of ['console', 'go'] as const) {
    const p = (json as Record<string, { api?: string; models?: Record<string, unknown> }>)[MODELS_DEV_ID[plan]];
    if (!p?.models) continue;
    for (const [id, raw] of Object.entries(p.models)) {
      const m = raw as { provider?: { npm?: string; api?: string }; cost?: { input?: number; output?: number } };
      const npm = m.provider?.npm ?? '';
      const format: OcFormat = npm.includes('anthropic') ? 'anthropic' : npm.includes('google') ? 'google'
        : npm === '@ai-sdk/openai' ? 'openai' : 'compatible';
      const api = (m.provider?.api ?? p.api ?? apiFor(plan, format)).replace(/\/$/, '');
      if (!api.startsWith('https://opencode.ai/')) continue; // beklenmeyen adres: kataloğa güvenme
      const input = Number(m.cost?.input ?? NaN);
      const output = Number(m.cost?.output ?? NaN);
      out[plan][id] = {
        id, format, api,
        free: (input === 0 && output === 0) || /-free$/.test(id) || id === 'big-pickle',
        cost: Number.isFinite(input) && Number.isFinite(output) ? { input, output } : undefined,
      };
    }
  }
  return Object.keys(out.console).length || Object.keys(out.go).length ? out : null;
}

export function loadOpencodeCatalog(file: string): { savedAt: number } | null {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { savedAt: number; catalog: OcCatalog };
    if (saved?.catalog?.console) {
      catalog = saved.catalog;
      return { savedAt: saved.savedAt };
    }
  } catch { /* yok */ }
  return null;
}

/** Kataloğu indirir, yalnız OpenCode kısmını saklar. Hata olursa eldeki katalog kalır. */
export async function refreshOpencodeCatalog(file: string): Promise<boolean> {
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'tulvez-code' } });
  if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`);
  const parsed = parseModelsDev(await res.json());
  if (!parsed) return false;
  catalog = parsed;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), catalog: parsed }));
  return true;
}

/** Kullanılabilir modeller: katalogdan (yoksa OpenCode'un listesinden); Console'da ücretsizler çıkarılır. */
export async function listOpencodeModels(plan: OcPlan, key: string): Promise<string[]> {
  let ids = Object.keys(catalog?.[plan] ?? {});
  if (!ids.length) {
    const res = await fetch(`${KOK[plan]}/v1/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(L(`Model listesi alınamadı (${res.status})`, `Could not get the model list (${res.status})`));
    ids = ((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
  }
  return ids.filter((id) => id !== 'test' && !(plan === 'console' && isFreeModel(id, plan))).sort();
}

/** Katalogda fiyatı olan modelin bu istekteki maliyeti (dolar); bilinmiyorsa null. */
export function opencodeCost(id: string, plan: OcPlan, inTokens: number, outTokens: number): number | null {
  const c = catalog?.[plan]?.[id]?.cost;
  return c ? (c.input * inTokens + c.output * outTokens) / 1_000_000 : null;
}
