import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseSettings } from './vsmock';

const { runAgent } = await import('../services/agent');

/** task aracı: alt ajan kendi bağlamında salt okuma araçlarıyla çalışır, raporu ana ajana döner. */

let server: http.Server;
let url = '';
const bodies: { system: string; tools: string[]; text: string }[] = [];

const sse = (res: http.ServerResponse, delta: unknown, finish: string | null = null): void => {
  res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'sahte', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body) as { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] };
      const system = JSON.stringify(j.messages.filter((m) => m.role === 'system'));
      const text = JSON.stringify(j.messages.filter((m) => m.role !== 'system'));
      bodies.push({ system, tools: (j.tools ?? []).map((t) => t.function.name), text });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (system.includes('alt ajansın')) {
        sse(res, { role: 'assistant', content: 'RAPOR: giriş noktası src/main.ts:12' }, 'stop');
      } else if (text.includes('RAPOR: giriş')) {
        sse(res, { role: 'assistant', content: 'Giriş noktası src/main.ts.' }, 'stop');
      } else {
        sse(res, { role: 'assistant', tool_calls: [{ index: 0, id: 't1', type: 'function', function: { name: 'task', arguments: JSON.stringify({ description: 'giriş noktasını bul', prompt: 'Uygulamanın giriş noktasını bul' }) } }] }, 'tool_calls');
      }
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

describe('alt ajan', () => {
  it('görevi ayrı bağlamda yürütür, salt okuma araçlarıyla; rapor ana ajana döner', async () => {
    const events: string[] = [];
    let answer = '';
    await runAgent({ ...baseSettings, aiProvider: 'ollama', model: 'sahte', apiKey: '', ollamaUrl: url, autoApproveCommands: true },
      'uygulamanın giriş noktası nerede bul', 'build', [], {
        onChunk: (t) => { answer += t; },
        onToolCall: (tool, summary) => events.push(`çağrı:${tool}:${summary}`),
        onToolResult: (r) => events.push(`sonuç:${r.tool}:${r.status}`),
        onToolRequest: async () => true,
        onDone: () => events.push('done'),
        onError: (e) => events.push(`hata:${e}`),
      });
    expect(events).toEqual(['çağrı:task:giriş noktasını bul', 'sonuç:task:ok', 'done']);
    expect(answer).toBe('Giriş noktası src/main.ts.');
    const sub = bodies.find((b) => b.system.includes('alt ajansın'))!;
    expect(sub.text).toContain('Uygulamanın giriş noktasını bul');
    // Alt ajan: yazma/komut araçları ve iç içe task yok
    expect(sub.tools).not.toContain('task');
    expect(sub.tools).not.toContain('write_file');
    expect(sub.tools).not.toContain('run_command');
    expect(sub.tools).toContain('read_files');
    // Ana ajanın ilk isteğinde task aracı var
    expect(bodies[0].tools).toContain('task');
  });
});
