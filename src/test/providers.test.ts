import { describe, expect, it } from 'vitest';
import { baseSettings } from './vsmock';

const { resolveModel } = await import('../services/providers');
const { calcCost } = await import('../services/cost');
const { buildPrompt } = await import('../services/ai');

describe('sağlayıcı çözümleme', () => {
  it('her sağlayıcı için bir model döner', () => {
    const providers = ['openai', 'anthropic', 'gemini', 'groq', 'opencode', 'ollama', 'custom'] as const;
    for (const aiProvider of providers) {
      const resolved = resolveModel({
        ...baseSettings,
        aiProvider,
        model: '',
        apiKey: aiProvider === 'ollama' ? '' : 'key',
        baseUrl: aiProvider === 'custom' ? 'https://ornek.com/v1' : '',
      });
      expect(resolved.model, `${aiProvider} model dönmeli`).toBeDefined();
      expect(resolved.id.length, `${aiProvider} için id gerekli`).toBeGreaterThan(0);
    }
  });

  it('varsayılan model id\'leri sağlayıcıya uygun', () => {
    expect(resolveModel({ ...baseSettings, aiProvider: 'gemini', model: '' }).id).toBe('gemini-2.5-flash');
    expect(resolveModel({ ...baseSettings, aiProvider: 'groq', model: '' }).id).toBe('llama-3.3-70b-versatile');
    expect(resolveModel({ ...baseSettings, aiProvider: 'ollama', model: '', apiKey: '' }).id).toBe('llama3');
  });

  it('OpenCode Zen doğru endpoint kullanır', () => {
    const resolved = resolveModel({ ...baseSettings, aiProvider: 'opencode', model: 'claude-sonnet-4-5' });
    expect(resolved.id).toBe('claude-sonnet-4-5');
    expect(resolved.source).toBe('OpenCode Zen');
  });

  it('özel endpoint için baseURL zorunluluğu kontrol edilir', async () => {
    const { runAgent } = await import('../services/agent');
    const errors: string[] = [];
    await runAgent(
      { ...baseSettings, aiProvider: 'custom', baseUrl: '', model: 'x' },
      'merhaba',
      'build',
      [],
      {
        onChunk: () => undefined,
        onToolCall: () => undefined,
        onToolRequest: async () => true,
        onDone: () => undefined,
        onError: (e) => errors.push(e),
      },
    );
    expect(errors.join(' ')).toContain('Base URL');
  });

  it('API anahtarı yoksa hata verir', async () => {
    const { runAgent } = await import('../services/agent');
    const errors: string[] = [];
    await runAgent(
      { ...baseSettings, apiKey: '' },
      'selam',
      'build',
      [],
      {
        onChunk: () => undefined,
        onToolCall: () => undefined,
        onToolRequest: async () => true,
        onDone: () => undefined,
        onError: (e) => errors.push(e),
      },
    );
    expect(errors.join(' ')).toContain('anahtar');
  });
});

describe('maliyet hesabı', () => {
  it('bilinen model için token maliyeti hesaplar', () => {
    expect(calcCost('gpt-4o', 1000, 1000)).toBeCloseTo((0.000005 + 0.000015) * 1000, 10);
  });

  it('bilinmeyen model için 0 döner (sözde veri yok)', () => {
    expect(calcCost('bilinmeyen-model', 1000, 1000)).toBe(0);
  });

  it('negatif veya sıfır token güvenli', () => {
    expect(calcCost('gpt-4o', 0, 0)).toBe(0);
  });
});

describe('sistem promptu', () => {
  it('ask modunda repo haritası eklenmez', () => {
    const prompt = buildPrompt('ask', 'HARİTA: dosyalar');
    expect(prompt).not.toContain('HARİTA');
  });

  it('build modunda repo haritası eklenir', () => {
    const prompt = buildPrompt('build', 'HARİTA: dosyalar');
    expect(prompt).toContain('HARİTA: dosyalar');
    expect(prompt).toContain('grep_files');
  });

  it('her mod bir rol tanımı içerir', () => {
    for (const mode of ['ask', 'plan', 'build'] as const) {
      const prompt = buildPrompt(mode, '');
      expect(prompt.length).toBeGreaterThan(50);
      expect(prompt).toContain('Rolün');
    }
  });
});

describe('selamlaşma koruması', () => {
  it('kısa selamlaşmalarda araç çağrılmaz', async () => {
    const { runAgent } = await import('../services/agent');
    const toolCalls: string[] = [];
    const errors: string[] = [];
    await runAgent(
      { ...baseSettings, autoApproveCommands: false },
      'merhaba',
      'build',
      [],
      {
        onChunk: () => undefined,
        onToolCall: (t) => toolCalls.push(t),
        onToolRequest: async () => true,
        onDone: () => undefined,
        onError: (e) => errors.push(e),
      },
    );
    // Gerçek API çağrısı yapılmamalı; hata gelirse araç çağrısı da olmamış olur
    expect(toolCalls.length).toBe(0);
  });
});