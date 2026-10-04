import { describe, expect, it } from 'vitest';
import { baseSettings } from './vsmock';

const { runAgent } = await import('../services/agent');

/**
 * Canlı sağlayıcı testleri.
 * Ortam değişkeni yoksa atlanır; CI'da secrets ile çalışır.
 * Örnek: TULVEZ_LIVE_GEMINI=<key> npm test
 */

interface LiveCase {
  env: string;
  provider: typeof baseSettings.aiProvider;
  model: string;
}

const cases: LiveCase[] = [
  { env: 'TULVEZ_LIVE_GEMINI', provider: 'gemini', model: 'gemini-2.5-flash' },
  { env: 'TULVEZ_LIVE_OPENAI', provider: 'openai', model: 'gpt-4o-mini' },
  { env: 'TULVEZ_LIVE_ANTHROPIC', provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  { env: 'TULVEZ_LIVE_GROQ', provider: 'groq', model: 'llama-3.3-70b-versatile' },
  { env: 'TULVEZ_LIVE_OPENCODE', provider: 'opencode', model: 'claude-sonnet-4-5' },
];

describe.each(cases)('canlı sağlayıcı: $provider', ({ env, provider, model }) => {
  const key = process.env[env];
  const run = key ? it : it.skip;

  run('araç çağrısı yapar ve metin döner', async () => {
    const chunks: string[] = [];
    const tools: string[] = [];
    const errors: string[] = [];
    let done = false;

    await runAgent(
      { ...baseSettings, aiProvider: provider, model, apiKey: key ?? '' },
      'package.json dosyasını oku ve sadece proje adını yaz',
      'build',
      [],
      {
        onChunk: (t) => chunks.push(t),
        onReasoning: () => undefined,
        onToolCall: (t) => tools.push(t),
        onToolRequest: async () => true,
        onDone: () => { done = true; },
        onError: (e) => errors.push(e),
      },
    );

    expect(errors, `${provider} hata verdi`).toEqual([]);
    expect(done, `${provider} akışı tamamlamadı`).toBe(true);
    expect(tools, `${provider} araç çağırmadı`).toContain('read_file');
    expect(chunks.join('').toLowerCase()).toContain('tulvez');
  }, 90_000);
});
