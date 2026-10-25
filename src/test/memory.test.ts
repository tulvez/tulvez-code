import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import type { ModelMessage } from 'ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setWorkspaceRoot } from './setup';
import { baseSettings } from './vsmock';

const { runAgent } = await import('../services/agent');
const { compactConversation, getConversation, saveConversation, withoutReasoning } = await import('../services/conversation');
const { beginCheckpoint, endCheckpoint, undoCheckpoint } = await import('../services/checkpoint');

/**
 * Sohbet hafızası: 1. turda okunan dosyanın içeriği 2. turda modele yeniden gitmeli
 * (yalnız düz metin geçmişiyle gitmiyordu). Sahte OpenAI uyumlu sunucu gelen istekleri kaydeder.
 */

const chunk = (res: http.ServerResponse, delta: unknown, finish: string | null = null): void => {
  res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'sahte', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
};

let server: http.Server;
let url = '';
const requests: { messages: { role: string; content?: unknown }[] }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as { messages: { role: string; content?: unknown }[] };
      requests.push(j);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const last = j.messages[j.messages.length - 1];
      if (last.role === 'user' && String(last.content).includes('liste tut')) {
        chunk(res, { tool_calls: [{ index: 0, id: 'call_t', type: 'function', function: { name: 'todo_write', arguments: JSON.stringify({ todos: [
          { content: 'Dosyayı oku', status: 'completed' }, { content: 'Testi yaz', status: 'in_progress' }, { content: '  ', status: 'pending' }, { content: 'Çalıştır', status: 'garip' },
        ] }) } }] });
        chunk(res, {}, 'tool_calls');
      } else if (last.role === 'user' && String(last.content).includes('notu değiştir')) {
        chunk(res, { tool_calls: [{ index: 0, id: 'call_w', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'not.txt', content: 'AJAN-YAZDI' }) } }] });
        chunk(res, {}, 'tool_calls');
      } else if (last.role === 'user' && String(last.content).includes('notu oku')) {
        chunk(res, { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'not.txt' }) } }] });
        chunk(res, {}, 'tool_calls');
      } else {
        chunk(res, { role: 'assistant', content: 'Tamam.' });
        chunk(res, {}, 'stop');
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

beforeEach(() => {
  requests.length = 0;
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-mem-'));
  fs.writeFileSync(path.join(ws, 'not.txt'), 'GIZLI-ICERIK-42', 'utf8');
  setWorkspaceRoot(ws);
});

const settings = () => ({ ...baseSettings, aiProvider: 'ollama' as const, model: 'sahte', apiKey: '', ollamaUrl: url });
const cb = (events: string[]) => ({
  onChunk: () => undefined,
  onToolCall: () => undefined,
  onToolRequest: async () => true,
  onDone: () => events.push('done'),
  onCancelled: () => events.push('cancelled'),
  onError: (e: string) => events.push(`error:${e}`),
});

describe('sohbet hafızası', () => {
  it('1. turda okunan dosya 2. turda modele gider; düz metin geçmişiyle gitmez', async () => {
    const events: string[] = [];
    let saved: ModelMessage[] = [];
    await runAgent(settings(), 'notu oku', 'ask', [], cb(events), undefined, { onConversation: (m) => { saved = m; } });
    expect(events).toEqual(['done']);
    expect(JSON.stringify(saved)).toContain('GIZLI-ICERIK-42');

    requests.length = 0;
    await runAgent(settings(), 'notta ne yazıyordu?', 'ask', [], cb(events), undefined, { prior: saved });
    expect(JSON.stringify(requests[0].messages)).toContain('GIZLI-ICERIK-42');

    requests.length = 0;
    await runAgent(settings(), 'notta ne yazıyordu?', 'ask',
      [{ role: 'user', text: 'notu oku' }, { role: 'assistant', text: 'Tamam.' }], cb(events));
    expect(JSON.stringify(requests[0].messages)).not.toContain('GIZLI-ICERIK-42');
  });

  it('kimlik ve tur sayısı tutmazsa kayıt kullanılmaz', () => {
    const msgs: ModelMessage[] = [{ role: 'user', content: 'a' }];
    saveConversation('s1', 1, msgs);
    expect(getConversation('s1', 1)).toBe(msgs);
    expect(getConversation('s1', 2)).toBeNull();
    expect(getConversation('baska', 1)).toBeNull();
    expect(getConversation(undefined, 1)).toBeNull();
  });
});

describe('konuşmayı sıkıştırma', () => {
  const turn = (i: number, out: string): ModelMessage[] => [
    { role: 'user', content: `soru ${i}` },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${i}`, toolName: 'read_file', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${i}`, toolName: 'read_file', output: { type: 'text', value: out } }] },
    { role: 'assistant', content: [{ type: 'text', text: `yanıt ${i}` }] },
  ];
  const big = 'x'.repeat(10_000);
  const conv = [...turn(1, big), ...turn(2, big), ...turn(3, big), ...turn(4, big)];
  const size = (m: ModelMessage[]) => m.reduce((n, x) => n + JSON.stringify(x.content).length, 0);

  it('bütçe içindeyse dokunmaz', () => {
    expect(compactConversation(conv, 1_000_000)).toBe(conv);
  });

  it('önce eski araç çıktılarını kısaltır, son iki tur aynen kalır', () => {
    const out = compactConversation(conv, 25_000);
    expect(out).toHaveLength(conv.length);
    expect(size(out)).toBeLessThanOrEqual(25_000);
    expect(JSON.stringify(out[2])).toContain('kısaltıldı');
    expect(out.slice(8)).toEqual(conv.slice(8)); // 3. ve 4. tur
  });

  it('yetmezse en eski turları bütünüyle atar; araç çağrısı ile sonucu birlikte gider', () => {
    const out = compactConversation(conv, 21_000);
    expect(out[0]).toEqual({ role: 'user', content: 'soru 3' });
    const calls = out.filter((m) => m.role === 'assistant').flatMap((m) => (typeof m.content === 'string' ? [] : m.content)).filter((p) => p.type === 'tool-call').length;
    const results = out.filter((m) => m.role === 'tool').length;
    expect(calls).toBe(results);
  });

  it('düşünme parçaları kaydedilmez', () => {
    const out = withoutReasoning([{ role: 'assistant', content: [{ type: 'reasoning', text: 'iç ses' }, { type: 'text', text: 'yanıt' }] }]);
    expect(JSON.stringify(out)).not.toContain('iç ses');
  });
});

describe('ajan akışında geri alma noktası', () => {
  it('Build modunda yazılan dosya kaydedilir ve geri alınır', async () => {
    const events: string[] = [];
    beginCheckpoint('akış');
    await runAgent(settings(), 'notu değiştir', 'build', [], cb(events));
    const cp = await endCheckpoint();
    expect(events).toEqual(['done']);
    expect(cp?.files).toHaveLength(1);
    const file = cp!.files[0];
    expect(fs.readFileSync(file, 'utf8')).toBe('AJAN-YAZDI');
    await undoCheckpoint('akış', async () => true);
    expect(fs.readFileSync(file, 'utf8')).toBe('GIZLI-ICERIK-42');
  });
});

describe('yapılacaklar listesi', () => {
  it('todo_write listesi arayüze gider, sohbet akışına araç adımı düşmez, modele özet döner', async () => {
    const events: string[] = [];
    const lists: { content: string; status: string }[][] = [];
    const toolCalls: string[] = [];
    await runAgent(settings(), 'liste tut', 'plan', [], { ...cb(events), onToolCall: (t) => toolCalls.push(t), onTodos: (items) => lists.push(items) });
    expect(events).toEqual(['done']);
    expect(toolCalls).toEqual([]);
    expect(lists[0]).toEqual([
      { content: 'Dosyayı oku', status: 'completed' },
      { content: 'Testi yaz', status: 'in_progress' },
      { content: 'Çalıştır', status: 'pending' },
    ]);
    const toolMsg = requests[1].messages.find((m) => m.role === 'tool');
    expect(String(toolMsg?.content)).toContain('(1/3 bitti)');
    expect(String(toolMsg?.content)).toContain('[~] Testi yaz');
  });
});
