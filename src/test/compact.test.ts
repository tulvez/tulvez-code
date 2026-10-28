import * as http from 'http';
import type { AddressInfo } from 'net';
import type { ModelMessage } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseSettings } from './vsmock';

const { summarizeConversation, compactedMessages } = await import('../services/agent');

/** /compact: konuşma modele özetletilir, özet konuşmanın yerine geçer. */

let server: http.Server;
let url = '';
const bodies: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      bodies.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'sahte', choices: [{ index: 0, message: { role: 'assistant', content: '## Hedef\nREADME yazmak' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('konuşmayı özetleme', () => {
  it('özet istenir, eski araç çıktıları budanır, özet konuşmanın yerine geçer', async () => {
    const big = 'x'.repeat(20_000);
    const turn = (n: number): ModelMessage[] => [
      { role: 'user', content: `istek ${n}` },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${n}`, toolName: 'read_file', input: { path: 'a' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${n}`, toolName: 'read_file', output: { type: 'text', value: big } }] },
      { role: 'assistant', content: [{ type: 'text', text: `yanıt ${n}` }] },
    ];
    const summary = await summarizeConversation({ ...baseSettings, aiProvider: 'ollama', model: 'sahte', apiKey: '', ollamaUrl: url }, [...turn(1), ...turn(2)]);
    expect(summary).toBe('## Hedef\nREADME yazmak');
    const body = bodies[bodies.length - 1];
    expect(body).toContain('özetlemek');
    // Son tur dışındaki büyük araç çıktısı kısaltıldı
    expect(body.split(big).length - 1).toBeLessThanOrEqual(1);
    const msgs = compactedMessages(summary);
    expect(msgs).toHaveLength(2);
    expect(JSON.stringify(msgs[0])).toContain('README yazmak');
  });
});
