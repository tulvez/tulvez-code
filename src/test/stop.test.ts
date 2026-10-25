import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseSettings } from './vsmock';

const { runAgent } = await import('../services/agent');

/**
 * Durdur düğmesi: sinyal ajana ulaşmalı, yanıt kesilmeli ve çalışan komut kapanmalı.
 * Sahte OpenAI uyumlu sunucu (ollama sağlayıcısı, anahtarsız) yanıtı yavaşça akıtır.
 */

const chunk = (res: http.ServerResponse, delta: unknown, finish: string | null = null): void => {
  res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'sahte', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
};

let server: http.Server;
let url = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as { messages?: { role: string }[] };
      const hasTool = (j.messages ?? []).some((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const text = JSON.stringify(j.messages ?? []);
      if (text.includes('uzun komut') && !hasTool) {
        // 30 saniye süren bir komut çağırır
        chunk(res, { role: 'assistant', content: 'Çalıştırıyorum.' });
        chunk(res, { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'node -e "setTimeout(() => {}, 30000)"' }) } }] });
        chunk(res, {}, 'tool_calls');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      // Yavaş metin: 10 saniyede 100 parça
      let i = 0;
      const timer = setInterval(() => {
        if (res.writableEnded) { clearInterval(timer); return; }
        chunk(res, { role: 'assistant', content: `parça ${i} ` });
        if (++i >= 100) {
          clearInterval(timer);
          chunk(res, {}, 'stop');
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 100);
      res.on('close', () => clearInterval(timer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const settings = () => ({ ...baseSettings, aiProvider: 'ollama' as const, model: 'sahte', apiKey: '', ollamaUrl: url });

describe('yanıtı durdurma', () => {
  it('akan yanıt durdurulunca ajan biter ve "durduruldu" bildirir, "bitti" bildirmez', async () => {
    const ac = new AbortController();
    const events: string[] = [];
    let chunks = 0;
    const started = Date.now();
    await runAgent(settings(), 'merhaba, uzunca anlat', 'ask', [], {
      onChunk: () => {
        chunks++;
        if (chunks === 3) ac.abort();
      },
      onToolCall: () => undefined,
      onToolRequest: async () => true,
      onDone: () => events.push('done'),
      onCancelled: () => events.push('cancelled'),
      onError: (e) => events.push(`error:${e}`),
    }, ac.signal);
    expect(events).toEqual(['cancelled']);
    expect(chunks).toBeLessThan(10);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('çalışan terminal komutu durdurulunca kapanır', async () => {
    const ac = new AbortController();
    const events: string[] = [];
    let toolOutput = '';
    const started = Date.now();
    await runAgent({ ...settings(), allowShellCommands: true, autoApproveCommands: true }, 'uzun komut çalıştır', 'build', [], {
      onChunk: () => undefined,
      onToolCall: () => { setTimeout(() => ac.abort(), 500); },
      onToolResult: (r) => { toolOutput = r.output; },
      onToolRequest: async () => true,
      onDone: () => events.push('done'),
      onCancelled: () => events.push('cancelled'),
      onError: (e) => events.push(`error:${e}`),
    }, ac.signal);
    // Komut 30 saniye sürecekti; durdurma onu birkaç saniyede bitirmeli
    expect(Date.now() - started).toBeLessThan(8000);
    expect(events).toEqual(['cancelled']);
    expect(toolOutput).toContain('kullanıcı durdurdu');
  }, 15000);
});
