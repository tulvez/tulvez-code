import { stepCountIs, streamText, type ModelMessage, type ToolSet } from 'ai';
import * as path from 'path';
import type { TulvezSettings } from './messages';
import { calcCost } from './cost';
import { buildPrompt } from './ai';
import type { AgentMode, ChatTurn } from './types';
import { TOOL_DEFINITIONS, applyBudget, executeTool, formatTodos, normalizeTodos, resolveEditPath, snapshotBeforeEdit, type TodoItem } from './tools';
import { buildRepoMap } from './repomap';
import { resolveModel, type ClientInfo } from './providers';
import { getSkillsRoot, localSkills, skillsPromptBlock } from './orgSkills';
import { compactConversation, withoutReasoning } from './conversation';
import { recordBefore } from './checkpoint';
import type { McpTool } from './mcp';
import { isFreeOnlyError } from './opencode';
import { L } from './i18n';

export interface AgentCallbacks {
  onChunk: (text: string) => void;
  /** callId, aynı çağrının sonucunu (onToolResult) eşlemek içindir. */
  onToolCall: (tool: string, summary: string, callId: string) => void;
  onToolResult?: (result: ToolResult) => void;
  onToolRequest: (id: string, tool: string, args: string) => Promise<boolean>;
  onDone: (usage: { inputTokens: number; outputTokens: number; costUsd: number; contextWindow: number; model: string }) => void;
  onCancelled?: () => void;
  /** Ajanın yapılacaklar listesi (todo_write) değişti */
  onTodos?: (items: TodoItem[]) => void;
  onReasoning?: (text: string) => void;
  onError: (err: string) => void;
}

export interface ToolResult {
  callId: string;
  tool: string;
  output: string;
  status: 'ok' | 'error' | 'rejected';
  exitCode?: number;
}

/** Arayüzde gösterilecek sonuç: araç sonucu uzun olabilir, baştan ve sondan kesilir. */
function previewOutput(text: string, max = 4000): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.6));
  const tail = text.slice(-Math.floor(max * 0.4));
  return `${head}\n… (${text.length - max} karakter gösterilmiyor) …\n${tail}`;
}

let repoMapCache: { text: string; builtAt: number } | null = null;

export function invalidateRepoMap(): void {
  repoMapCache = null;
}

async function repoMapFor(): Promise<string> {
  if (repoMapCache && Date.now() - repoMapCache.builtAt < 60_000) return repoMapCache.text;
  try {
    const map = await buildRepoMap();
    repoMapCache = { text: map.text, builtAt: Date.now() };
    return map.text;
  } catch {
    return '';
  }
}

function contextWindow(model: string): number {
  if (model.includes('gemini')) return 1048576;
  if (model.includes('claude')) return 200000;
  if (model.includes('o1') || model.includes('gpt-5')) return 400000;
  if (model.includes('gpt-4o')) return 128000;
  if (model.includes('gpt-4')) return 8192;
  if (model.includes('llama')) return 128000;
  if (model.includes('mixtral')) return 32768;
  if (model.includes('gemma') || model.includes('qwen')) return 32768;
  if (model.includes('mimo') || model.includes('ling') || model.includes('nemotron')) return 128000;
  return 128000;
}

function isTrivialRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?.,]/g, '');
  if (t.length > 24) return false;
  const trivial = ['merhaba', 'selam', 'hey', 'hi', 'hello', 'merhaba tulvez', 'sen kimsin',
    'kimsin', 'kimsin sen', 'ne yapabilirsin', 'nasilsin', 'iyi misin', 'teskirler'];
  return trivial.includes(t);
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  if (name === 'run_command') return String(args.command ?? '');
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file' || name === 'replace_in_file') {
    return String(args.path ?? '');
  }
  if (name === 'read_files') return (Array.isArray(args.paths) ? (args.paths as string[]) : []).join(', ');
  if (name === 'grep_files') return `${args.pattern ?? ''}${args.include ? ` (${args.include})` : ''}`;
  if (name === 'list_files' || name === 'list_dir') return String(args.directory ?? '.');
  if (name === 'web_fetch') return String(args.url ?? '');
  return JSON.stringify(args).slice(0, 120);
}

/** Ask ve Plan salt okur: yazma ve komut araçları yalnız Build modunda modele verilir. */
export function toolsForMode(mode: AgentMode): typeof TOOL_DEFINITIONS {
  return TOOL_DEFINITIONS.filter((t) => mode === 'build' || t.readOnly);
}

let toolReqCounter = 0;
const nextToolReqId = () => `tool-${Date.now()}-${toolReqCounter++}`;

/** Araç şemasını AI SDK formatına çevirir ve execute ile birleştirir. */
function buildToolSet(
  settings: TulvezSettings,
  defs: typeof TOOL_DEFINITIONS,
  cb: AgentCallbacks,
  mcpTools: McpTool[] = [],
): ToolSet {
  const tools: ToolSet = {};
  // MCP araçları: ne yaptıkları bilinmediği için her çağrı onaylıdır (Tam erişim hariç)
  for (const t of mcpTools) {
    tools[t.name] = {
      description: t.description,
      inputSchema: t.inputSchema as ToolSet[string]['inputSchema'],
      execute: async (args: Record<string, unknown>, options?: { abortSignal?: AbortSignal }) => {
        const callId = nextToolReqId();
        cb.onToolCall(t.name, JSON.stringify(args).slice(0, 120), callId);
        if (!settings.autoApproveCommands) {
          const allowed = await cb.onToolRequest(nextToolReqId(), t.name, JSON.stringify(args, null, 2).slice(0, 2000));
          if (!allowed) {
            cb.onToolResult?.({ callId, tool: t.name, output: L('Kullanıcı aracı reddetti.', 'The user denied the tool.'), status: 'rejected' });
            return L('Kullanıcı aracı reddetti.', 'The user denied the tool.');
          }
        }
        try {
          const out = await t.execute(args, options?.abortSignal);
          cb.onToolResult?.({ callId, tool: t.name, output: previewOutput(out), status: /^Hata\b/.test(out) ? 'error' : 'ok' });
          return applyBudget(out);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          cb.onToolResult?.({ callId, tool: t.name, output: message, status: 'error' });
          return `${L('Hata', 'Error')}: ${message}`;
        }
      },
    } as ToolSet[string];
  }
  for (const def of defs) {
    tools[def.name] = {
      description: def.description,
      inputSchema: def.schema as ToolSet[string]['inputSchema'],
      execute: async (args: Record<string, unknown>, options?: { abortSignal?: AbortSignal }) => {
        // Yapılacaklar listesi sohbet akışına adım olarak düşmez; giriş kutusunun üstünde gösterilir
        if (def.name === 'todo_write') {
          const items = normalizeTodos(args);
          cb.onTodos?.(items);
          return formatTodos(items);
        }
        const callId = nextToolReqId();
        const report = (output: string, status: ToolResult['status'], exitCode?: number): void => {
          cb.onToolResult?.({ callId, tool: def.name, output: previewOutput(output), status, exitCode });
        };
        cb.onToolCall(def.name, toolSummary(def.name, args), callId);
        if (def.requiresApproval && !settings.autoApproveCommands) {
          const allowed = await cb.onToolRequest(
            nextToolReqId(),
            def.name,
            JSON.stringify(args, null, 2).slice(0, 2000),
          );
          if (!allowed) {
            report(L('Kullanıcı aracı reddetti.', 'The user denied the tool.'), 'rejected');
            return L('Kullanıcı aracı reddetti.', 'The user denied the tool.');
          }
        }
        if (def.name === 'write_file' || def.name === 'replace_in_file') {
          const target = resolveEditPath(String(args.path ?? ''));
          if (target) {
            await recordBefore(target);
            await snapshotBeforeEdit(target);
          }
        }
        const meta: { exitCode?: number; signal?: AbortSignal } = { signal: options?.abortSignal };
        let result: string;
        try {
          result = await executeTool(def.name, args, settings.allowShellCommands, undefined, meta);
        } catch (err) {
          report(err instanceof Error ? err.message : String(err), 'error');
          throw err;
        }
        const failed = meta.exitCode !== undefined ? meta.exitCode !== 0 : /^Hata\b/.test(result);
        report(result, failed ? 'error' : 'ok', meta.exitCode);
        return applyBudget(result);
      },
    } as ToolSet[string];
  }
  return tools;
}

/** Tek istekte en çok adım (araç çağrısı + yanıt). Durdur her an keser. */
export const MAX_STEPS = 50;

export interface AgentOptions {
  /** Önceki turların tam konuşması (araç sonuçları dahil); yoksa düz metin geçmişi kullanılır. */
  prior?: ModelMessage[] | null;
  /** Tur başarıyla bitince bu turla birlikte güncel konuşma. */
  onConversation?: (messages: ModelMessage[]) => void;
  /** Bağlı MCP sunucularının araçları (yalnız Build modunda verilir). */
  mcpTools?: McpTool[];
  /** Sağlayıcıya kendimizi tanıtmak için: eklenti sürümü ve sohbet kimliği */
  client?: ClientInfo;
}

export async function runAgent(
  settings: TulvezSettings,
  userMessage: string,
  mode: AgentMode,
  history: ChatTurn[],
  callbacks: AgentCallbacks,
  signal?: AbortSignal,
  memory?: AgentOptions,
): Promise<void> {
  if (settings.aiProvider === 'custom' && !settings.baseUrl) {
    callbacks.onError(L("Base URL boş. Ayarlar'dan OpenAI uyumlu endpoint adresini girin.", 'The base URL is empty. Enter the OpenAI-compatible endpoint address in Settings.'));
    return;
  }
  if (settings.aiProvider !== 'ollama' && !settings.apiKey) {
    callbacks.onError(L("API anahtarı eksik. Ayarlar'dan ekleyin.", 'The API key is missing. Add it in Settings.'));
    return;
  }

  const trivial = isTrivialRequest(userMessage);
  const repoMap = trivial ? '' : await repoMapFor();
  const skills = trivial ? '' : skillsPromptBlock(localSkills(getSkillsRoot()));
  const system = buildPrompt(mode, repoMap, skills);
  const allowed = trivial ? [] : toolsForMode(mode);

  let resolved;
  try {
    resolved = resolveModel(settings, memory?.client);
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err));
    return;
  }

  // Konuşma bağlam penceresinin yaklaşık yarısına sığdırılır (1 token ≈ 3–4 karakter); çok büyük
  // pencerelerde de maliyet şişmesin diye üst sınır var.
  const budget = Math.min(contextWindow(resolved.id) * 2, 400_000);
  const past: ModelMessage[] = memory?.prior?.length
    ? memory.prior
    : history.map<ModelMessage>((t) => ({
      role: t.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: t.text }],
    }));
  const messages: ModelMessage[] = [
    ...compactConversation(past, budget),
    { role: 'user', content: userMessage },
  ];

  const maxAttempts = settings.autoApproveCommands ? 1 : 3;
  let chunkSeen = false;
  const cb: AgentCallbacks = {
    ...callbacks,
    onChunk: (text) => {
      chunkSeen = true;
      callbacks.onChunk(text);
    },
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    chunkSeen = false;
    try {
      const tools = buildToolSet(settings, allowed, cb, mode === 'build' && !trivial ? memory?.mcpTools : []);
      const result = streamText({
        model: resolved.model,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: signal,
        maxRetries: 0,
        // Bazı OpenAI-uyumlu uç noktalar (örn. gpt-oss-20b) önceki adımın
        // düşünme (reasoning) parçalarını geri kabul etmez. Düşünme hâlâ
        // üretilir ve arayüzde gösterilir; sadece isteğe geri eklenmez.
        prepareStep: async ({ messages }) => ({ messages: withoutReasoning(messages) }),
      });

      let sawText = false;
      let streamError: { message: string } | null = null;
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          if (part.text) { sawText = true; cb.onChunk(part.text); }
        } else if (part.type === 'reasoning-delta') {
          if (part.text) cb.onReasoning?.(part.text);
        } else if (part.type === 'error') {
          streamError = { message: (part.error as { message?: string })?.message ?? String(part.error) };
        }
      }

      // Durdurulunca SDK hata fırlatmaz: akış "abort" parçasıyla kapanır ve usage/text
      // beklenirse sonuç gelmeyebilir. Normal bitiş gibi işlenmesin.
      if (signal?.aborted) {
        cb.onCancelled?.();
        return;
      }

      if (streamError) throw new Error(streamError.message);

      const usage = await result.usage;
      const finishReason = await result.finishReason;
      const text = (await result.text).trim();

      if (!text && !sawText && finishReason !== 'tool-calls') {
        cb.onChunk(L('_(Model boş yanıt döndü. Modeli değiştirmeyi veya isteği kısaltmayı dene.)_', '_(The model returned an empty reply. Try another model or a shorter request.)_'));
      } else if (finishReason === 'length') {
        cb.onChunk(L('\n\n_⚠️ Cevap modelin çıktı sınırında kesildi. Devam etmek için "devam" yazabilirsin._', '\n\n_⚠️ The reply was cut off at the model\'s output limit. Type "continue" to go on._'));
      } else if (finishReason === 'tool-calls') {
        cb.onChunk(L(`\n\n_⚠️ Bu istekte ${MAX_STEPS} adım sınırına ulaştım. Kaldığım yerden sürdürmem için "devam" yaz._`, `\n\n_⚠️ I reached the ${MAX_STEPS}-step limit for this request. Type "continue" for me to pick up where I left off._`));
      }

      if (memory?.onConversation) {
        const produced = await result.responseMessages;
        memory.onConversation(withoutReasoning([...messages, ...produced]));
      }

      cb.onDone({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        costUsd: resolved.cost?.(usage.inputTokens ?? 0, usage.outputTokens ?? 0) ?? calcCost(resolved.id, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
        contextWindow: contextWindow(resolved.id),
        model: resolved.id,
      });
      return;
    } catch (err) {
      if (signal?.aborted) {
        cb.onCancelled?.();
        return;
      }
      const raw = err instanceof Error ? err.message : String(err);
      if (!isRetryable(raw) || attempt >= maxAttempts || chunkSeen) {
        cb.onError(raw);
        return;
      }
      await delay(1200 * attempt * attempt);
    }
  }
}

function isRetryable(message: string): boolean {
  // OpenCode'un "ücretsiz modeller yalnız OpenCode'da" yanıtı 429 olsa da beklemekle geçmez
  if (isFreeOnlyError(message)) return false;
  const m = message.toLowerCase();
  // Günlük kota tükendiyse tekrar denemenin anlamı yok (saatlerce sürebilir)
  if (m.includes('exceeded your current quota') || m.includes('quota exceeded') || m.includes('billing')) {
    return false;
  }
  return (
    m.includes('429') || m.includes('503') || m.includes('502') || m.includes('500') ||
    m.includes('overloaded') || m.includes('high demand') ||
    m.includes('econnreset') || m.includes('etimedout') || m.includes('socket hang up') ||
    m.includes('fetch failed') || m.includes('network') || m.includes('rate limit')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}