import * as http from 'http';
import type { AddressInfo } from 'net';
import type { ModelMessage } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseSettings } from './vsmock';

const { runAgent, requestLimitFrom } = await import('../services/agent');
const { fitToolResults } = await import('../services/conversation');

/**
 * Sağlayıcının istek başına token sınırı (Groq ücretsiz plan: "Request too large … Limit 8000"):
 * ajan sınırı iletiden öğrenir, araç çıktılarını kısaltıp aynı yerden yeniden dener.
 */

const BIG = 'x'.repeat(40_000);
const TOO_LARGE = JSON.stringify({ error: { message: 'Request too large for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 13194, please reduce your message size and try again.', type: 'tokens', code: 'rate_limit_exceeded' } });

let server: http.Server;
let url = '';
const bodies: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      bodies.push(body);
      if (body.includes('x'.repeat(10_000))) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(TOO_LARGE);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'sahte-kucuk', choices: [{ index: 0, delta: { role: 'assistant', content: 'tamam' }, finish_reason: 'stop' }] })}\n\n`);
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

const prior: ModelMessage[] = [
  { role: 'user', content: 'dosyayı oku' },
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: { path: 'a.txt' } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', output: { type: 'text', value: BIG } }] },
  { role: 'assistant', content: [{ type: 'text', text: 'okudum' }] },
];

describe('istek sınırı', () => {
  it('"Request too large": sınır öğrenilir, araç çıktısı kısaltılıp yeniden denenir', async () => {
    bodies.length = 0;
    const events: string[] = [];
    await runAgent({ ...baseSettings, aiProvider: 'ollama', model: 'sahte-kucuk', apiKey: '', ollamaUrl: url, autoApproveCommands: true },
      'bu dosya ne anlatıyor özetle', 'ask', [], {
        onChunk: (t) => events.push(`chunk:${t}`),
        onToolCall: () => undefined,
        onToolRequest: async () => true,
        onDone: () => events.push('done'),
        onError: (e) => events.push(`error:${e}`),
      }, undefined, { prior });
    expect(events).toEqual(['chunk:tamam', 'done']);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].length).toBeLessThan(bodies[0].length - 30_000);
    expect(bodies[1]).toContain('istek sınırı yüzünden atlandı');
  });

  it('sınır iletiden okunur; başka hatalar sınır hatası sayılmaz', () => {
    expect(requestLimitFrom(JSON.parse(TOO_LARGE).error.message)).toBe(8000);
    expect(requestLimitFrom("This model's maximum context length is 32768 tokens")).toBe(32768);
    expect(requestLimitFrom('Rate limit reached … Limit 8000')).toBeNull();
  });

  it('fitToolResults en büyük çıktıyı kısaltır, küçükleri ve sırayı korur', () => {
    const msgs: ModelMessage[] = [
      ...prior,
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c2', toolName: 'read_file', output: { type: 'text', value: 'küçük' } }] },
    ];
    const out = fitToolResults(msgs, 6000);
    expect(out).toHaveLength(msgs.length);
    expect(JSON.stringify(out).length).toBeLessThan(7000);
    expect(JSON.stringify(out[4])).toContain('küçük');
    // Asıl dizi değişmez
    expect(JSON.stringify(msgs[2])).toContain(BIG);
  });
});
