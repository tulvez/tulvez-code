import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { TulvezSettings } from './messages';
import { rateLimitedFetch } from './rateLimit';
import { DEFAULT_OPENCODE_MODEL, freeOnlyMessage, opencodeCost, routeFor, type OcPlan } from './opencode';

export type ResolvedModel = {
  model: LanguageModel;
  id: string;
  source: string;
  /** Sağlayıcıya özel maliyet hesabı (dolar); yoksa genel fiyat tablosu kullanılır */
  cost?: (inTokens: number, outTokens: number) => number | null;
};

/**
 * Tüm sağlayıcılar tek noktada. Vercel AI SDK (MIT) her sağlayıcının
 * tool-calling, streaming, reasoning ve hata semantiğini normalize eder.
 */
/** OpenCode'un başka araçlardan istediği tanıtım: kendi User-Agent'ımız ve sohbet başına sabit oturum kimliği. */
export interface ClientInfo { version?: string; sessionId?: string }

export function resolveModel(settings: TulvezSettings, client: ClientInfo = {}): ResolvedModel {
  const provider = settings.aiProvider;
  const key = settings.apiKey;

  if (provider === 'anthropic') {
    const anthropic = createAnthropic({ apiKey: key, fetch: rateLimitedFetch });
    return {
      model: anthropic(settings.model || 'claude-3-5-haiku-20241022'),
      id: settings.model || 'claude-3-5-haiku-20241022',
      source: 'Anthropic',
    };
  }

  if (provider === 'gemini') {
    const google = createGoogleGenerativeAI({ apiKey: key, fetch: rateLimitedFetch });
    return {
      model: google.chat(settings.model || 'gemini-2.5-flash'),
      id: settings.model || 'gemini-2.5-flash',
      source: 'Google Gemini',
    };
  }

  if (provider === 'openai') {
    const openai = createOpenAI({ apiKey: key, fetch: rateLimitedFetch });
    return {
      model: openai.chat(settings.model || 'gpt-4o-mini'),
      id: settings.model || 'gpt-4o-mini',
      source: 'OpenAI',
    };
  }

  if (provider === 'groq') {
    const groq = createOpenAICompatible({
      name: 'groq',
      apiKey: key,
      baseURL: 'https://api.groq.com/openai/v1',
      includeUsage: true,
      fetch: rateLimitedFetch,
    });
    const id = settings.model || 'llama-3.3-70b-versatile';
    return { model: groq.chatModel(id), id, source: 'Groq' };
  }

  if (provider === 'opencode' || provider === 'opencode-go') {
    // Console (kullandıkça öde) ve Go (abonelik) aynı modelleri farklı adreslerden verir
    const plan: OcPlan = provider === 'opencode-go' ? 'go' : 'console';
    const id = settings.model || DEFAULT_OPENCODE_MODEL;
    const route = routeFor(id, plan);
    if (plan === 'console' && route.free) throw new Error(freeOnlyMessage());
    const source = plan === 'go' ? 'OpenCode Go' : 'OpenCode';
    const cost = (i: number, o: number) => opencodeCost(id, plan, i, o);
    // OpenCode Go bunları ister (Console'da da yönlendirme ve önbelleğe yarar)
    const headers: Record<string, string> = { 'User-Agent': `tulvez-code/${client.version ?? 'dev'}` };
    if (client.sessionId) headers['x-opencode-session'] = `tulvez-${client.sessionId}`;
    if (route.format === 'anthropic') {
      return { model: createAnthropic({ apiKey: key, baseURL: route.api, headers, fetch: rateLimitedFetch })(id), id, source, cost };
    }
    if (route.format === 'openai') {
      return { model: createOpenAI({ apiKey: key, baseURL: route.api, headers, fetch: rateLimitedFetch }).responses(id), id, source, cost };
    }
    if (route.format === 'google') {
      return { model: createGoogleGenerativeAI({ apiKey: key, baseURL: route.api, headers, fetch: rateLimitedFetch }).chat(id), id, source, cost };
    }
    const compat = createOpenAICompatible({ name: 'opencode', apiKey: key, baseURL: route.api, includeUsage: true, headers, fetch: rateLimitedFetch });
    return { model: compat.chatModel(id), id, source, cost };
  }

  if (provider === 'openrouter') {
    const router = createOpenAICompatible({
      name: 'openrouter',
      apiKey: key,
      baseURL: 'https://openrouter.ai/api/v1',
      // OpenRouter'ın önerdiği uygulama başlıkları (istatistik ve sıralamada uygulama adı)
      headers: { 'HTTP-Referer': 'https://tulvez.com', 'X-Title': 'Tulvez Code' },
      includeUsage: true,
      fetch: rateLimitedFetch,
    });
    const id = settings.model || 'qwen/qwen3-coder';
    return { model: router.chatModel(id), id, source: 'OpenRouter' };
  }

  if (provider === 'ollama') {
    const ollama = createOpenAICompatible({
      name: 'ollama',
      apiKey: key || 'ollama',
      baseURL: `${(settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1`,
      includeUsage: true,
      fetch: rateLimitedFetch,
    });
    const id = settings.model || 'llama3';
    return { model: ollama.chatModel(id), id, source: 'Ollama' };
  }

  const custom = createOpenAICompatible({
    name: 'custom',
    apiKey: key,
    baseURL: (settings.baseUrl || '').replace(/\/$/, ''),
    includeUsage: true,
    fetch: rateLimitedFetch,
  });
  const id = settings.model || 'gpt-4o-mini';
  return { model: custom.chatModel(id), id, source: 'Özel endpoint' };
}

export function providerError(provider: string): string | null {
  if (provider === 'custom' && !provider) return null;
  return null;
}