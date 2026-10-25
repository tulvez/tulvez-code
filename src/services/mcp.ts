import * as fs from 'fs';
import * as path from 'path';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';

/**
 * MCP (Model Context Protocol) sunucuları: dış araçlar (veritabanı, GitHub, tarayıcı…).
 *
 * Biçim Claude Code / Cursor ile aynı:
 *   { "ad": { "command": "npx", "args": ["-y", "paket"], "env": {…} } }      ← yerel (stdio)
 *   { "ad": { "url": "https://…/mcp", "type": "http" | "sse", "headers": {…} } }  ← uzak
 * Kaynaklar: kullanıcı ayarı `tulvez.mcpServers` ve projedeki `.mcp.json` ({ "mcpServers": {…} }).
 * Proje sunucuları komut çalıştırabildiği için kullanıcı onay vermeden başlatılmaz (eklenti sorar).
 * Araçlar `mcp__<sunucu>__<araç>` adıyla, yalnız Build modunda ve onaylı çalışır.
 */

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: 'http' | 'sse';
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface McpServerEntry { name: string; config: McpServerConfig; source: 'user' | 'project' }

export interface McpTool {
  /** Modelin gördüğü ad: mcp__sunucu__araç (en çok 64 karakter) */
  name: string;
  server: string;
  description: string;
  inputSchema: unknown;
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
}

export interface McpStatus { name: string; source: 'user' | 'project'; state: 'connected' | 'error' | 'disabled' | 'pending'; tools: number; error?: string }

const CONNECT_TIMEOUT_MS = 20_000;
const NAME_RE = /[^a-zA-Z0-9_-]+/g;

function asConfig(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const strRecord = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string')) as Record<string, string>;
  };
  const cfg: McpServerConfig = {
    command: typeof o.command === 'string' ? o.command : undefined,
    args: Array.isArray(o.args) ? o.args.filter((a): a is string => typeof a === 'string') : undefined,
    env: strRecord(o.env),
    cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
    url: typeof o.url === 'string' ? o.url : undefined,
    type: o.type === 'sse' ? 'sse' : o.type === 'http' || o.type === 'streamable-http' ? 'http' : undefined,
    headers: strRecord(o.headers),
    disabled: o.disabled === true,
  };
  return cfg.command || cfg.url ? cfg : null;
}

/** Ayar nesnesini ya da .mcp.json içeriğini sunucu listesine çevirir; bozuk kayıtlar atlanır. */
export function parseMcpServers(raw: unknown, source: 'user' | 'project'): McpServerEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = (raw as { mcpServers?: unknown }).mcpServers ?? raw;
  if (!obj || typeof obj !== 'object') return [];
  const out: McpServerEntry[] = [];
  for (const [name, value] of Object.entries(obj as Record<string, unknown>)) {
    const config = asConfig(value);
    const clean = name.replace(NAME_RE, '_').slice(0, 24);
    if (config && clean) out.push({ name: clean, config, source });
  }
  return out;
}

export function readProjectMcp(root: string | undefined): McpServerEntry[] {
  if (!root) return [];
  for (const file of ['.mcp.json', path.join('.tulvez', 'mcp.json')]) {
    try {
      return parseMcpServers(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')), 'project');
    } catch { /* yok ya da bozuk */ }
  }
  return [];
}

/** Proje sunucularının onay anahtarı: komut/adres değişirse yeniden sorulur. */
export function projectApprovalKey(entries: McpServerEntry[]): string {
  return JSON.stringify(entries.filter((e) => e.source === 'project').map((e) => [e.name, e.config.command, e.config.args, e.config.url]));
}

export function toolName(server: string, tool: string): string {
  return `mcp__${server}__${tool.replace(NAME_RE, '_')}`.slice(0, 64);
}

/** MCP araç sonucunu modele gidecek metne çevirir. */
export function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  const r = (result ?? {}) as { content?: unknown; isError?: boolean; structuredContent?: unknown };
  const parts = Array.isArray(r.content) ? r.content : [];
  const text = parts.map((p) => {
    const part = (p ?? {}) as { type?: string; text?: string; resource?: { uri?: string; text?: string } };
    if (part.type === 'text') return part.text ?? '';
    if (part.type === 'resource') return part.resource?.text ?? `(kaynak: ${part.resource?.uri ?? '?'})`;
    if (part.type === 'image') return '(görsel — metin olarak gösterilemiyor)';
    return JSON.stringify(part);
  }).join('\n').trim() || (r.structuredContent ? JSON.stringify(r.structuredContent, null, 2) : '(boş sonuç)');
  return r.isError ? `Hata: ${text}` : text;
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} ${ms / 1000} saniyede yanıt vermedi`)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sunucuları bağlar, araçlarını toplar; yapılandırma değişince yeniden bağlar. */
export class McpManager {
  private clients = new Map<string, MCPClient>();
  private tools: McpTool[] = [];
  private status: McpStatus[] = [];
  private key = '';
  private connecting: Promise<void> | null = null;

  constructor(private readonly log: (msg: string) => void = () => undefined) {}

  getStatus(): McpStatus[] { return this.status; }

  /** Yapılandırma aynıysa bağlı araçları döndürür; değiştiyse yeniden bağlar. */
  async toolsFor(entries: McpServerEntry[], cwd: string | undefined): Promise<McpTool[]> {
    const key = JSON.stringify([entries, cwd]);
    if (key !== this.key) {
      this.key = key;
      this.connecting = this.connectAll(entries, cwd);
    }
    await this.connecting;
    return this.tools;
  }

  async reconnect(entries: McpServerEntry[], cwd: string | undefined): Promise<McpTool[]> {
    this.key = '';
    return this.toolsFor(entries, cwd);
  }

  async close(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    this.tools = [];
    await Promise.allSettled(all.map((c) => c.close()));
  }

  private async connectAll(entries: McpServerEntry[], cwd: string | undefined): Promise<void> {
    await this.close();
    this.status = entries.map((e) => ({ name: e.name, source: e.source, state: e.config.disabled ? 'disabled' : 'pending', tools: 0 }));
    const results = await Promise.all(entries.map(async (entry, i): Promise<McpTool[]> => {
      if (entry.config.disabled) return [];
      try {
        const tools = await withTimeout(this.connect(entry, cwd), CONNECT_TIMEOUT_MS, `${entry.name} sunucusu`);
        this.status[i] = { ...this.status[i], state: 'connected', tools: tools.length };
        this.log(`MCP ✓ ${entry.name}: ${tools.length} araç`);
        return tools;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.status[i] = { ...this.status[i], state: 'error', error: message.slice(0, 300) };
        this.log(`MCP ✗ ${entry.name}: ${message}`);
        return [];
      }
    }));
    const seen = new Set<string>();
    this.tools = results.flat().filter((t) => !seen.has(t.name) && !!seen.add(t.name));
  }

  private async connect(entry: McpServerEntry, cwd: string | undefined): Promise<McpTool[]> {
    const { config } = entry;
    const transport = config.command
      ? new StdioMCPTransport({
        command: config.command,
        args: config.args,
        // Taşıyıcı yalnız temel değişkenleri (PATH, HOME…) aktarır; sırlar ayarda açıkça verilmeli
        env: config.env,
        cwd: config.cwd ? path.resolve(cwd ?? process.cwd(), config.cwd) : cwd,
        stderr: 'ignore',
      })
      : { type: config.type ?? 'http', url: config.url!, headers: config.headers, redirect: 'follow' as const };
    const client = await createMCPClient({ transport, clientName: 'tulvez-code' });
    this.clients.set(entry.name, client);
    const set = await client.tools();
    return Object.entries(set).map(([name, t]) => {
      const tool = t as { description?: string; inputSchema: unknown; execute?: (args: unknown, opts: unknown) => Promise<unknown> };
      return {
        name: toolName(entry.name, name),
        server: entry.name,
        description: `[MCP · ${entry.name}] ${tool.description ?? name}`.slice(0, 1024),
        inputSchema: tool.inputSchema,
        execute: async (args: Record<string, unknown>, signal?: AbortSignal) => {
          if (!tool.execute) return 'Hata: araç çalıştırılamıyor.';
          return resultText(await tool.execute(args, { toolCallId: `mcp-${Date.now()}`, messages: [], abortSignal: signal }));
        },
      };
    });
  }
}
