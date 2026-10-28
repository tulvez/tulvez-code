import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { baseSettings } from './vsmock';

const oc = await import('../services/opencode');
const { resolveModel } = await import('../services/providers');
const { runAgent } = await import('../services/agent');

const ORNEK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'models-dev-ornek.json'), 'utf8'));
const settings = (aiProvider: 'opencode' | 'opencode-go', model: string) => ({ ...baseSettings, aiProvider, model, apiKey: 'anahtar' });
const internal = (m: unknown) => m as { provider: string; modelId: string; config?: { url?: (o: { path: string }) => string; baseURL?: string } };

afterEach(() => oc.setOpencodeCatalog(null));

describe('OpenCode kataloğu', () => {
  it('models.dev\'den biçim, adres, fiyat ve ücretsiz bilgisi okunur; Console ile Go ayrı', () => {
    const c = oc.parseModelsDev(ORNEK)!;
    expect(c.console['claude-sonnet-4-5']).toMatchObject({ format: 'anthropic', api: 'https://opencode.ai/inference/anthropic/v1', free: false, cost: { input: 3, output: 15 } });
    expect(c.console['gpt-5.4-mini']).toMatchObject({ format: 'openai', api: 'https://opencode.ai/inference/openai/v1' });
    expect(c.console['gemini-3-flash']).toMatchObject({ format: 'google', api: 'https://opencode.ai/inference/google/v1beta' });
    expect(c.console['qwen3.8-max'].format).toBe('compatible');
    expect(c.go['qwen3.8-max']).toMatchObject({ format: 'anthropic', api: 'https://opencode.ai/inference/go/anthropic/v1' });
    expect(c.console['big-pickle'].free).toBe(true);
    expect(c.console['glm-5.3-flash-free'].free).toBe(true);
    expect(c.console['deepseek-v4.1-flash'].free).toBe(false);
  });

  it('katalog yoksa model adından tahmin edilir', () => {
    expect(oc.routeFor('claude-haiku-5-5', 'console')).toMatchObject({ format: 'anthropic', api: 'https://opencode.ai/inference/anthropic/v1' });
    expect(oc.routeFor('gpt-6-luna', 'go')).toMatchObject({ format: 'openai', api: 'https://opencode.ai/inference/go/openai/v1' });
    expect(oc.routeFor('gemini-4-argon', 'console').format).toBe('google');
    expect(oc.routeFor('kimi-k3', 'console')).toMatchObject({ format: 'compatible', api: 'https://opencode.ai/inference/openai/v1' });
    expect(oc.isFreeModel('big-pickle')).toBe(true);
    expect(oc.isFreeModel('nemotron-3.5-lightning-free')).toBe(true);
    expect(oc.isFreeModel('deepseek-v4.1-flash')).toBe(false);
  });

  it('opencode.ai dışını gösteren katalog kaydı kullanılmaz', () => {
    const kotu = JSON.parse(JSON.stringify(ORNEK));
    kotu.opencode.models['deepseek-v4.1-flash'].provider = { api: 'https://kotu.example/v1' };
    expect(oc.parseModelsDev(kotu)!.console['deepseek-v4.1-flash']).toBeUndefined();
  });

  it('kaydet / yükle ve fiyat', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tz-oc-')), 'k.json');
    fs.writeFileSync(file, JSON.stringify({ savedAt: 123, catalog: oc.parseModelsDev(ORNEK) }));
    expect(oc.loadOpencodeCatalog(file)).toEqual({ savedAt: 123 });
    expect(oc.opencodeCost('claude-sonnet-4-5', 'console', 1_000_000, 100_000)).toBeCloseTo(4.5);
    expect(oc.opencodeCost('bilinmeyen', 'console', 1, 1)).toBeNull();
  });

  it('model listesinde Console\'un ücretsiz modelleri yok, Go\'da var', async () => {
    oc.setOpencodeCatalog(oc.parseModelsDev(ORNEK));
    const konsol = await oc.listOpencodeModels('console', 'x');
    expect(konsol).toContain('deepseek-v4.1-flash');
    expect(konsol).not.toContain('big-pickle');
    expect(konsol).not.toContain('glm-5.3-flash-free');
    expect(await oc.listOpencodeModels('go', 'x')).toContain('beam-free');
  });
});

describe('OpenCode sağlayıcısı', () => {
  it('her model doğru biçimle ve adresle çağrılır', () => {
    oc.setOpencodeCatalog(oc.parseModelsDev(ORNEK));
    const claude = internal(resolveModel(settings('opencode', 'claude-sonnet-4-5')).model);
    expect(claude.provider).toContain('anthropic');
    expect(claude.config?.url?.({ path: '/messages' }) ?? claude.config?.baseURL).toContain('opencode.ai/inference/anthropic/v1');
    const gpt = internal(resolveModel(settings('opencode', 'gpt-5.4-mini')).model);
    expect(gpt.provider).toBe('openai.responses');
    const goQwen = internal(resolveModel(settings('opencode-go', 'qwen3.8-max')).model);
    expect(goQwen.provider).toContain('anthropic');
    const deepseek = resolveModel(settings('opencode', ''));
    expect(deepseek.id).toBe('deepseek-v4.1-flash'); // varsayılan artık ucuz bir model
    expect(internal(deepseek.model).provider).toContain('opencode');
    expect(deepseek.cost?.(1_000_000, 0)).toBeCloseTo(0.3);
  });

  it('OpenCode\'a kendini tanıtır: User-Agent ve sohbet başına oturum kimliği', async () => {
    const m = internal(resolveModel(settings('opencode-go', 'deepseek-v4.1-flash'), { version: '0.3.1', sessionId: '42' }).model) as unknown as { config: { headers: () => Record<string, string> } };
    const h = await m.config.headers();
    expect(h['x-opencode-session']).toBe('tulvez-42');
    expect(h['User-Agent'] ?? h['user-agent']).toMatch(/^tulvez-code\/0\.3\.1/);
  });

  it('Console\'da ücretsiz model seçiliyse istek gönderilmeden açıklanır; Go\'da engellenmez', () => {
    oc.setOpencodeCatalog(oc.parseModelsDev(ORNEK));
    expect(() => resolveModel(settings('opencode', 'big-pickle'))).toThrow(/yalnız OpenCode’un kendi uygulamasında/);
    expect(() => resolveModel(settings('opencode-go', 'beam-free'))).not.toThrow();
  });
});

describe('"yalnız OpenCode\'da" hatası', () => {
  it('tanınır ve tekrar denenmez (önceden 429 diye 3 kez deneniyordu)', async () => {
    let istek = 0;
    const server = http.createServer((_q, r) => {
      istek++;
      r.writeHead(429, { 'content-type': 'application/json' });
      r.end(JSON.stringify({ type: 'error', error: { type: 'FreeUsageLimitError', message: 'Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go' } }));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const hatalar: string[] = [];
    await runAgent({ ...baseSettings, aiProvider: 'custom', baseUrl: url, model: 'big-pickle', apiKey: 'x', autoApproveCommands: false }, 'merhaba', 'ask', [], {
      onChunk: () => undefined, onToolCall: () => undefined, onToolRequest: async () => true,
      onDone: () => undefined, onError: (e) => hatalar.push(e),
    });
    server.close();
    expect(istek).toBe(1);
    expect(hatalar).toHaveLength(1);
    expect(oc.isFreeOnlyError(hatalar[0])).toBe(true);
    expect(oc.isFreeOnlyError('429 Too Many Requests')).toBe(false);
  });
});
