import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { baseSettings } from './vsmock';

const { runAgent } = await import('../services/agent');
const { retryAfterSeconds } = await import('../services/rateLimit');

/**
 * Sağlayıcı hız sınırı (429): yalnız başarısız adım retry-after'a uyularak yeniden denenir ve
 * SDK hatayı console.error ile terminale basmaz (CLI arayüzünü bozuyordu).
 */

const GROQ_429 = JSON.stringify({ error: { message: 'Rate limit reached for model `x` on tokens per minute (TPM): Limit 8000, Used 4920, Requested 5451. Please try again in 17.78s.', type: 'tokens', code: 'rate_limit_exceeded' } });

let server: http.Server;
let url = '';
let requests = 0;
/** Kaç istek 429 alsın */
let failFirst = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests++;
      if (requests <= failFirst) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        res.end(GROQ_429);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'sahte', choices: [{ index: 0, delta: { role: 'assistant', content: 'tamam' }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// autoApproveCommands: ajanın kendi tur tekrarı kapalı (yalnız SDK'nın adım tekrarı ölçülür)
const settings = () => ({ ...baseSettings, aiProvider: 'ollama' as const, model: 'sahte', apiKey: '', ollamaUrl: url, autoApproveCommands: true });

function run() {
  const events: string[] = [];
  const done = runAgent(settings(), 'açıkla şunu lütfen ayrıntılı', 'ask', [], {
    onChunk: (t) => events.push(`chunk:${t}`),
    onToolCall: () => undefined,
    onToolRequest: async () => true,
    onRateLimitWait: (s) => events.push(`bekle:${s}`),
    onDone: () => events.push('done'),
    onError: (e) => events.push(`error:${e}`),
  });
  return { events, done };
}

describe('hız sınırı', () => {
  it('429 sonrası istek bekleyip yinelenir, bekleme bildirilir, yanıt gelir', async () => {
    requests = 0;
    failFirst = 1;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { events, done } = run();
    await done;
    expect(events).toEqual(['bekle:0', 'chunk:tamam', 'done']);
    expect(requests).toBe(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('sürekli 429: 3 beklemeden sonra hata kullanıcıya iletilir, tur baştan alınmaz, terminale basılmaz', async () => {
    requests = 0;
    failFirst = 99;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { events, done } = run();
    await done;
    expect(events.filter((e) => e.startsWith('bekle:'))).toHaveLength(3);
    expect(events[events.length - 1]).toMatch(/^error:.*Rate limit/);
    // 1 istek + 3 bekleyip yineleme; dış döngü hız sınırında turu yeniden başlatmaz
    expect(requests).toBe(4);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('retry-after okuma', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('başlıklar ve ileti gövdesi', () => {
    expect(retryAfterSeconds(h({ 'retry-after': '18' }))).toBe(18);
    expect(retryAfterSeconds(h({ 'retry-after-ms': '1500' }))).toBe(1.5);
    expect(retryAfterSeconds(h({}), 'Please try again in 17.78s.')).toBeCloseTo(17.78);
    expect(retryAfterSeconds(h({}), 'try again in 1m2.5s')).toBeCloseTo(62.5);
    expect(retryAfterSeconds(h({}), 'başka bir hata')).toBeNull();
  });
});
