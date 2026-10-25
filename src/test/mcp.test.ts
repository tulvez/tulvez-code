import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setWorkspaceRoot } from './setup';
import { baseSettings } from './vsmock';

const { McpManager, parseMcpServers, projectApprovalKey, readProjectMcp, resultText, toolName } = await import('../services/mcp');
const { runAgent } = await import('../services/agent');

const MINI = path.join(__dirname, 'fixtures', 'mini-mcp.cjs');
const mini = (env?: Record<string, string>) => ({ name: 'mini', source: 'user' as const, config: { command: process.execPath, args: [MINI], env } });

describe('MCP yapılandırması', () => {
  it('ayar ve .mcp.json biçimi okunur; bozuk kayıt atlanır, ad temizlenir', () => {
    const list = parseMcpServers({ mcpServers: {
      'git hub': { command: 'npx', args: ['-y', 'x', 1], env: { A: 'b', N: 3 } },
      uzak: { url: 'https://ornek.dev/mcp', type: 'streamable-http', headers: { Authorization: 'x' } },
      bozuk: { args: [] },
      kapali: { command: 'x', disabled: true },
    } }, 'project');
    expect(list.map((e) => e.name)).toEqual(['git_hub', 'uzak', 'kapali']);
    expect(list[0].config).toMatchObject({ command: 'npx', args: ['-y', 'x'], env: { A: 'b' } });
    expect(list[1].config).toMatchObject({ url: 'https://ornek.dev/mcp', type: 'http' });
    expect(list[2].config.disabled).toBe(true);
    expect(parseMcpServers(null, 'user')).toEqual([]);
  });

  it('projedeki .mcp.json okunur; onay anahtarı komut değişince değişir', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-mcp-'));
    fs.writeFileSync(path.join(ws, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'node', args: ['a.js'] } } }));
    const a = readProjectMcp(ws);
    expect(a).toEqual([{ name: 'db', source: 'project', config: expect.objectContaining({ command: 'node', args: ['a.js'] }) }]);
    fs.writeFileSync(path.join(ws, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'node', args: ['kotu.js'] } } }));
    expect(projectApprovalKey(readProjectMcp(ws))).not.toBe(projectApprovalKey(a));
  });

  it('araç adı ve sonuç metni', () => {
    expect(toolName('mini', 'topla sayı')).toBe('mcp__mini__topla_say_');
    expect(toolName('s', 'x'.repeat(100))).toHaveLength(64);
    expect(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: '' }] })).toBe('a\n(görsel — metin olarak gösterilemiyor)');
    expect(resultText({ content: [{ type: 'text', text: 'kötü' }], isError: true })).toBe('Hata: kötü');
  });
});

describe('MCP sunucusuna bağlanma', () => {
  it('stdio sunucusuna bağlanır, araçları listeler ve çalıştırır; ayardaki env aktarılır', async () => {
    const mgr = new McpManager();
    const tools = await mgr.toolsFor([mini({ MINI_ETIKET: 'ayardan' })], os.tmpdir());
    expect(tools.map((t) => t.name)).toEqual(['mcp__mini__topla', 'mcp__mini__patla']);
    expect(tools[0].description).toBe('[MCP · mini] İki sayıyı toplar');
    expect(await tools[0].execute({ a: 2, b: 3 })).toBe('Sonuç: 5 (ayardan)');
    expect(await tools[1].execute({})).toBe('Hata: bir şeyler ters gitti');
    expect(mgr.getStatus()).toEqual([{ name: 'mini', source: 'user', state: 'connected', tools: 2 }]);
    await mgr.close();
  }, 20_000);

  it('çalışmayan sunucu hata olarak görünür, diğerleri bağlanır', async () => {
    const mgr = new McpManager();
    const tools = await mgr.toolsFor([
      { name: 'yok', source: 'user', config: { command: path.join(os.tmpdir(), 'olmayan-komut-xyz') } },
      mini(),
      { name: 'kapali', source: 'user', config: { command: 'x', disabled: true } },
    ], os.tmpdir());
    expect(tools).toHaveLength(2);
    const st = mgr.getStatus();
    expect(st[0]).toMatchObject({ name: 'yok', state: 'error' });
    expect(st[1]).toMatchObject({ name: 'mini', state: 'connected', tools: 2 });
    expect(st[2]).toMatchObject({ name: 'kapali', state: 'disabled' });
    await mgr.close();
  }, 30_000);
});

describe('ajan MCP aracını kullanır', () => {
  const chunk = (res: http.ServerResponse, delta: unknown, finish: string | null = null): void => {
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'sahte', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  };
  let server: http.Server;
  let url = '';
  const seenTools: string[][] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const j = JSON.parse(body) as { messages: { role: string }[]; tools?: { function: { name: string } }[] };
        seenTools.push((j.tools ?? []).map((t) => t.function.name));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const hasTool = j.messages.some((m) => m.role === 'tool');
        if (!hasTool && (j.tools ?? []).some((t) => t.function.name === 'mcp__mini__topla')) {
          chunk(res, { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'mcp__mini__topla', arguments: '{"a":40,"b":2}' } }] });
          chunk(res, {}, 'tool_calls');
        } else {
          chunk(res, { role: 'assistant', content: 'Tamam.' });
          chunk(res, {}, 'stop');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setWorkspaceRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'tz-mcpws-')));
  });
  afterAll(() => { server.closeAllConnections(); server.close(); });

  it('Build modunda onaylanınca çalışır; Ask modunda araç verilmez', async () => {
    const mgr = new McpManager();
    const mcpTools = await mgr.toolsFor([mini()], os.tmpdir());
    const settings = { ...baseSettings, aiProvider: 'ollama' as const, model: 'sahte', apiKey: '', ollamaUrl: url, autoApproveCommands: false };
    const asked: string[] = [];
    const results: string[] = [];
    await runAgent(settings, 'topla', 'build', [], {
      onChunk: () => undefined, onToolCall: () => undefined,
      onToolRequest: async (_id, tool) => { asked.push(tool); return true; },
      onToolResult: (r) => results.push(`${r.status}:${r.output}`),
      onDone: () => undefined, onError: (e) => results.push(`error:${e}`),
    }, undefined, { mcpTools });
    expect(asked).toEqual(['mcp__mini__topla']);
    expect(results).toEqual(['ok:Sonuç: 42 (etiketsiz)']);

    seenTools.length = 0;
    await runAgent(settings, 'topla', 'ask', [], {
      onChunk: () => undefined, onToolCall: () => undefined, onToolRequest: async () => true,
      onDone: () => undefined, onError: () => undefined,
    }, undefined, { mcpTools });
    expect(seenTools[0]).not.toContain('mcp__mini__topla');
    await mgr.close();
  }, 30_000);
});
