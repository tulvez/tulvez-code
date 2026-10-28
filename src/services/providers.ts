import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { TulvezSettings } from './messages';
import { rateLimitedFetch } from './rateLimit';

export type ResolvedModel = {
  model: ReturnType<ReturnType<typeof createOpenAI>['chat']>;
  id: string;
  source: string;
};

/**
 * Tüm sağlayıcılar tek noktada. Vercel AI SDK (MIT) her sağlayıcının
 * tool-calling, streaming, reasoning ve hata semantiğini normalize eder.
 */
export function resolveModel(settings: TulvezSettings): ResolvedModel {
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

  if (provider === 'opencode') {
    const zen = createOpenAICompatible({
      name: 'opencode-zen',
      apiKey: key,
      baseURL: 'https://opencode.ai/zen/v1',
      includeUsage: true,
      fetch: rateLimitedFetch,
    });
    const id = settings.model || 'claude-sonnet-4-5';
    return { model: zen.chatModel(id), id, source: 'OpenCode Zen' };
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