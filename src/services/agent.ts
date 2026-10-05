import { stepCountIs, streamText, type ModelMessage, type ToolSet } from 'ai';
import * as path from 'path';
import type { TulvezSettings } from './messages';
import { calcCost } from './cost';
import { buildPrompt } from './ai';
import type { AgentMode, ChatTurn } from './types';
import { TOOL_DEFINITIONS, applyBudget, executeTool, resolveEditPath, snapshotBeforeEdit } from './tools';
import { buildRepoMap } from './repomap';
import { resolveModel } from './providers';

export interface AgentCallbacks {
  onChunk: (text: string) => void;
  onToolCall: (tool: string, summary: string) => void;
  onToolRequest: (id: string, tool: string, args: string) => Promise<boolean>;
  onDone: (usage: { inputTokens: number; outputTokens: number; costUsd: number; contextWindow: number; model: string }) => void;
  onCancelled?: () => void;
  onReasoning?: (text: string) => void;
  onError: (err: string) => void;
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
  return JSON.stringify(args).slice(0, 120);
}

let toolReqCounter = 0;
const nextToolReqId = () => `tool-${Date.now()}-${toolReqCounter++}`;

/** Araç şemasını AI SDK formatına çevirir ve execute ile birleştirir. */
function buildToolSet(
  settings: TulvezSettings,
  defs: typeof TOOL_DEFINITIONS,
  cb: AgentCallbacks,
): ToolSet {
  const tools: ToolSet = {};
  for (const def of defs) {
    tools[def.name] = {
      description: def.description,
      inputSchema: def.schema as ToolSet[string]['inputSchema'],
      execute: async (args: Record<string, unknown>) => {
        cb.onToolCall(def.name, toolSummary(def.name, args));
        if (def.requiresApproval && !settings.autoApproveCommands) {
          const allowed = await cb.onToolRequest(
            nextToolReqId(),
            def.name,
            JSON.stringify(args, null, 2).slice(0, 2000),
          );
          if (!allowed) return 'Kullanıcı aracı reddetti.';
        }
        if (def.name === 'write_file' || def.name === 'replace_in_file') {
          const target = resolveEditPath(String(args.path ?? ''));
          if (target) await snapshotBeforeEdit(target);
        }
        const result = await executeTool(def.name, args, settings.allowShellCommands);
        return applyBudget(result);
      },
    } as ToolSet[string];
  }
  return tools;
}

export async function runAgent(
  settings: TulvezSettings,
  userMessage: string,
  mode: AgentMode,
  history: ChatTurn[],
  callbacks: AgentCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  if (settings.aiProvider === 'custom' && !settings.baseUrl) {
    callbacks.onError('Base URL boş. Ayarlar\'dan OpenAI uyumlu endpoint adresini girin.');
    return;
  }
  if (settings.aiProvider !== 'ollama' && !settings.apiKey) {
    callbacks.onError('API anahtarı eksik. Ayarlar\'dan ekleyin.');
    return;
  }

  const trivial = isTrivialRequest(userMessage);
  const repoMap = trivial ? '' : await repoMapFor();
  const system = buildPrompt(mode, repoMap);
  const allowed = TOOL_DEFINITIONS.filter((t) => (mode !== 'ask' || t.readOnly) && !trivial);

  let resolved;
  try {
    resolved = resolveModel(settings);
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err));
    return;
  }

  const messages: ModelMessage[] = [
    ...history.map<ModelMessage>((t) => ({
      role: t.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: t.text }],
    })),
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
      const tools = buildToolSet(settings, allowed, cb);
      const result = streamText({
        model: resolved.model,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(12),
        abortSignal: signal,
        maxRetries: 0,
        // Bazı OpenAI-uyumlu uç noktalar (örn. gpt-oss-20b) önceki adımın
        // düşünme (reasoning) parçalarını geri kabul etmez. Düşünme hâlâ
        // üretilir ve arayüzde gösterilir; sadece isteğe geri eklenmez.
        prepareStep: async ({ messages }) => ({
          messages: messages.map((m) => {
            if (m.role !== 'assistant' || typeof m.content === 'string') return m;
            const content = m.content.filter(
              (p) => p.type === 'text' || p.type === 'tool-call',
            );
            return { ...m, content };
          }),
        }),
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

      if (streamError) throw new Error(streamError.message);

      const usage = await result.usage;
      const finishReason = await result.finishReason;
      const text = (await result.text).trim();

      if (!text && !sawText && finishReason !== 'tool-calls') {
        cb.onChunk('_(Model boş yanıt döndü. Modeli değiştirmeyi veya isteği kısaltmayı dene.)_');
      } else if (finishReason === 'length') {
        cb.onChunk('\n\n_⚠️ Cevap modelin çıktı sınırında kesildi. Devam etmek için "devam" yazabilirsin._');
      }

      cb.onDone({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        costUsd: calcCost(resolved.id, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
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