import type { TulvezSettings } from './messages';

/**
 * Sağlayıcının hesabında gerçekten kullanılabilen modelleri döndürür.
 * Not: AI SDK model listelemeyi soyutlamaz; her sağlayıcının kendi uç noktası kullanılır.
 */
export async function listProviderModels(settings: TulvezSettings): Promise<string[]> {
  const provider = settings.aiProvider;
  const key = settings.apiKey;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id).sort();
  }

  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const json = (await res.json()) as { models?: { name: string }[] };
    return (json.models ?? [])
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => !id.includes('embedding') && !id.includes('tts') && !id.includes('aqa'))
      .sort();
  }

  if (provider === 'ollama') {
    const res = await fetch(`${(settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`);
    const json = (await res.json()) as { models?: { name: string }[] };
    return (json.models ?? []).map((m) => m.name).sort();
  }

  const baseURL =
    provider === 'groq' ? 'https://api.groq.com/openai/v1'
    : provider === 'opencode' ? 'https://opencode.ai/zen/v1'
    : provider === 'custom' ? (settings.baseUrl || '').replace(/\/$/, '')
    : 'https://api.openai.com/v1';

  const res = await fetch(`${baseURL}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) throw new Error(`Model listesi alınamadı (${res.status})`);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}