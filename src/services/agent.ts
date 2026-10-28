import { generateText, stepCountIs, streamText, type ModelMessage, type SystemModelMessage, type ToolSet } from 'ai';
import * as path from 'path';
import type { TulvezSettings } from './messages';
import { calcCost } from './cost';
import { buildChatPrompt, buildPrompt } from './ai';
import type { AgentMode, ChatTurn } from './types';
import { TOOL_DEFINITIONS, applyBudget, executeTool, formatTodos, normalizeTodos, resolveEditPath, snapshotBeforeEdit, type TodoItem } from './tools';
import { buildRepoMap } from './repomap';
import { resolveModel } from './providers';
import { getSkillsRoot, localSkills, skillsPromptBlock } from './orgSkills';
import { compactConversation, fitToolResults, pruneOldToolResults, withoutReasoning } from './conversation';
import { recordBefore } from './checkpoint';
import type { McpTool } from './mcp';
import { onRateLimitWait } from './rateLimit';
import { host } from './host';

export interface AgentCallbacks {
  onChunk: (text: string) => void;
  /** callId, aynı çağrının sonucunu (onToolResult) eşlemek içindir. */
  onToolCall: (tool: string, summary: string, callId: string) => void;
  onToolResult?: (result: ToolResult) => void;
  onToolRequest: (id: string, tool: string, args: string) => Promise<boolean>;
  /** cachedInputTokens: girdinin sağlayıcı önbelleğinden gelen kısmı (bilinmiyorsa yok) */
  /** contextTokens: son adımın girdisi (bağlam doluluğu = contextTokens / contextWindow) */
  onDone: (usage: { inputTokens: number; outputTokens: number; costUsd: number; contextWindow: number; model: string; cachedInputTokens?: number; contextTokens?: number }) => void;
  onCancelled?: () => void;
  /** Ajanın yapılacaklar listesi (todo_write) değişti */
  onTodos?: (items: TodoItem[]) => void;
  onReasoning?: (text: string) => void;
  /**
   * Her araçtan önce (izin kuralları, PreToolUse hook'u): "deny" aracı çalıştırmaz, gerekçe modele gider;
   * "allow" onay sormadan çalıştırır; "ask" ya da dönüş yoksa her zamanki onay akışı.
   */
  onBeforeTool?: (tool: string, args: Record<string, unknown>) => Promise<ToolDecision | void>;
  /** Her araçtan sonra (PostToolUse hook'u): dönen metin araç sonucuna eklenir ve modele gider */
  onAfterTool?: (tool: string, args: Record<string, unknown>, result: string) => Promise<string | void>;
  /** Sağlayıcı hız sınırı: istek bu kadar saniye bekleyip yinelenecek */
  onRateLimitWait?: (seconds: number) => void;
  onError: (err: string) => void;
}

export interface ToolDecision {
  decision: 'allow' | 'deny' | 'ask';
  reason?: string;
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

/**
 * Proje haritası istemin sabit önekinde durur. Sağlayıcı önbelleği (Groq gpt-oss, OpenAI, Gemini otomatik;
 * Anthropic işaretle) yalnız önek birebir aynıysa tutar: Groq'ta önbellekten gelen giriş dakikalık token
 * sınırına sayılmaz. Bu yüzden harita her istekte değil, yalnız yapay zekâ dosya değiştirince (eklenti)
 * ya da 30 dakikada bir yeniden üretilir.
 */
const REPO_MAP_TTL = 30 * 60_000;
let repoMapCache: { text: string; builtAt: number; root: string } | null = null;

export function invalidateRepoMap(): void {
  repoMapCache = null;
}

async function repoMapFor(): Promise<string> {
  const root = host().workspaceRoot() ?? '';
  if (repoMapCache && repoMapCache.root === root && Date.now() - repoMapCache.builtAt < REPO_MAP_TTL) return repoMapCache.text;
  try {
    const map = await buildRepoMap();
    repoMapCache = { text: map.text, builtAt: Date.now(), root };
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

/**
 * Sağlayıcının istek başına token sınırı (ör. Groq ücretsiz plan: dakikada 8.000). İlk "istek çok
 * büyük" hatasında iletiden öğrenilir; sonraki adımlarda araç çıktıları buna sığacak kadar kısaltılır.
 */
const requestLimits = new Map<string, number>();

/** "Request too large … Limit 8000, Requested 13194" → 8000; sınır hatası değilse null, sayı yoksa 0. */
export function requestLimitFrom(message: string): number | null {
  const m = message.toLowerCase();
  if (!/request too large|reduce your message size|context[_ ]length|maximum context length|prompt is too long|too many tokens/.test(m)) return null;
  const limit = /limit\s*:?\s*(\d+)/i.exec(message) ?? /maximum context length is (\d+)/i.exec(message);
  return limit ? Number(limit[1]) : 0;
}

const TRIVIAL = new Set([
  'merhaba', 'merhabalar', 'selam', 'selamlar', 'slm', 'mrb', 'hey', 'hi', 'hello', 'merhaba tulvez', 'selam tulvez',
  'sen kimsin', 'kimsin', 'kimsin sen', 'ne yapabilirsin', 'nasilsin', 'naber', 'nbr', 'iyi misin', 'nasil gidiyor',
  'tesekkurler', 'tesekkur ederim', 'tsk', 'sag ol', 'sagol', 'eyvallah', 'gunaydin', 'iyi aksamlar', 'iyi geceler',
  'tamam', 'tamamdir', 'ok', 'okey', 'peki', 'super', 'harika', 'thanks', 'thank you',
]);

/**
 * Selamlaşma ve kısa sohbet: modele proje haritası, proje talimatları ve araç tanımları gitmez
 * (her istekte binlerce token tutuyordu; "merhaba"ya yanıt için gereksiz).
 */
export function isTrivialRequest(text: string): boolean {
  const t = text.trim().toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[.!?,:;)(]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 30) return false;
  return TRIVIAL.has(t) || TRIVIAL.has(t.replace(/ (sen|siz)$/, '')) || TRIVIAL.has(t.replace(/^(selam|merhaba) /, ''));
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
  if (name === 'web_search') return String(args.query ?? '');
  if (name === 'task') return String(args.description ?? '');
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
        const pre = await cb.onBeforeTool?.(t.name, args);
        if (pre?.decision === 'deny') {
          const msg = `Engellendi${pre.reason ? `: ${pre.reason}` : ' (izin kuralı)'}`;
          cb.onToolResult?.({ callId, tool: t.name, output: msg, status: 'rejected' });
          return msg;
        }
        if (!settings.autoApproveCommands && pre?.decision !== 'allow') {
          const allowed = await cb.onToolRequest(nextToolReqId(), t.name, JSON.stringify(args, null, 2).slice(0, 2000));
          if (!allowed) {
            cb.onToolResult?.({ callId, tool: t.name, output: 'Kullanıcı aracı reddetti.', status: 'rejected' });
            return 'Kullanıcı aracı reddetti.';
          }
        }
        try {
          let out = await t.execute(args, options?.abortSignal);
          cb.onToolResult?.({ callId, tool: t.name, output: previewOutput(out), status: /^Hata\b/.test(out) ? 'error' : 'ok' });
          const extra = await cb.onAfterTool?.(t.name, args, out);
          if (extra) out = `${out}\n\n${extra}`;
          return applyBudget(out);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          cb.onToolResult?.({ callId, tool: t.name, output: message, status: 'error' });
          return `Hata: ${message}`;
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
        if (def.name === 'task') {
          const callId = nextToolReqId();
          cb.onToolCall('task', toolSummary('task', args), callId);
          const report = await runSubagent(settings, String(args.prompt ?? ''), cb, options?.abortSignal);
          cb.onToolResult?.({ callId, tool: 'task', output: previewOutput(report), status: /^Hata\b/.test(report) ? 'error' : 'ok' });
          return applyBudget(report, 12_000);
        }
        const callId = nextToolReqId();
        const report = (output: string, status: ToolResult['status'], exitCode?: number): void => {
          cb.onToolResult?.({ callId, tool: def.name, output: previewOutput(output), status, exitCode });
        };
        cb.onToolCall(def.name, toolSummary(def.name, args), callId);
        const pre = await cb.onBeforeTool?.(def.name, args);
        if (pre?.decision === 'deny') {
          const msg = `Engellendi${pre.reason ? `: ${pre.reason}` : ' (izin kuralı)'}`;
          report(msg, 'rejected');
          return msg;
        }
        if (def.requiresApproval && !settings.autoApproveCommands && pre?.decision !== 'allow') {
          const allowed = await cb.onToolRequest(
            nextToolReqId(),
            def.name,
            JSON.stringify(args, null, 2).slice(0, 2000),
          );
          if (!allowed) {
            report('Kullanıcı aracı reddetti.', 'rejected');
            return 'Kullanıcı aracı reddetti.';
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
        const extra = await cb.onAfterTool?.(def.name, args, result);
        if (extra) result = `${result}\n\n${extra}`;
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
  /** Alt ajan olarak çalışıyor: task aracı verilmez (iç içe alt ajan yok), istem rolü söyler */
  subagent?: boolean;
  /** Kullanıcı mesajına eklenen görseller (ekran görüntüsü vb.) */
  images?: { data: Uint8Array; mediaType: string }[];
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
    callbacks.onError('Base URL boş. Ayarlar\'dan OpenAI uyumlu endpoint adresini girin.');
    return;
  }
  if (settings.aiProvider !== 'ollama' && !settings.apiKey) {
    callbacks.onError('API anahtarı eksik. Ayarlar\'dan ekleyin.');
    return;
  }

  const trivial = !memory?.images?.length && isTrivialRequest(userMessage);
  const repoMap = trivial ? '' : await repoMapFor();
  const skills = trivial ? '' : skillsPromptBlock(localSkills(getSkillsRoot()));
  const system = trivial ? buildChatPrompt(mode)
    : memory?.subagent ? `${buildPrompt(mode, repoMap, skills)}\n\n${SUBAGENT_NOTE}` : buildPrompt(mode, repoMap, skills);
  const allowed = trivial ? [] : toolsForMode(mode).filter((t) => !(memory?.subagent && t.name === 'task'));

  let resolved;
  try {
    resolved = resolveModel(settings);
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
    ...compactConversation(pruneOldToolResults(past), budget),
    memory?.images?.length
      ? { role: 'user', content: [{ type: 'text', text: userMessage }, ...memory.images.map((img) => ({ type: 'image' as const, image: img.data, mediaType: img.mediaType }))] }
      : { role: 'user', content: userMessage },
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

  // Model talimatı ve araç tanımları da sınıra sayılır (1 token ≈ 3 karakter, temkinli)
  const fixedChars = system.length + JSON.stringify(allowed.map((t) => [t.description, t.schema])).length;
  const fit = (msgs: ModelMessage[]): ModelMessage[] => {
    const limit = requestLimits.get(resolved.id);
    if (!limit) return msgs;
    return fitToolResults(msgs, Math.max(3000, Math.floor(limit * 3 * 0.8) - fixedChars));
  };
  const cacheMarked = settings.aiProvider === 'anthropic';
  const systemMessage: SystemModelMessage = { role: 'system', content: system, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } };
  // Son adımın konuşması: sınır aşılınca tur baştan değil buradan sürer (araçlar yeniden çalışmaz)
  const step: { last: ModelMessage[] | null } = { last: null };
  let shrinkRetries = 0;

  const offRateLimit = onRateLimitWait((seconds) => callbacks.onRateLimitWait?.(seconds));
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      chunkSeen = false;
      try {
        const tools = buildToolSet(settings, allowed, cb, mode === 'build' && !trivial ? memory?.mcpTools : []);
        const result = streamText({
          model: resolved.model,
          // Anthropic önbelleği açıkça ister: sistem mesajına işaret (araç tanımları da öneke dahil)
          system: cacheMarked ? systemMessage : system,
          messages: fit(messages),
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
          abortSignal: signal,
          // Hız sınırı (429) sağlayıcının fetch'inde beklenip yinelenir (rateLimit.ts: yalnız başarısız
          // istek, retry-after'a uyarak); SDK'nın kendi yeniden denemesi üst üste bekletmesin diye kapalı
          maxRetries: 0,
          // Varsayılan onError hatayı console.error ile basar; hata zaten akıştan yakalanıp gösteriliyor
          // (CLI'da terminal arayüzünü bozuyordu)
          onError: () => {},
          // Bazı OpenAI-uyumlu uç noktalar (örn. gpt-oss-20b) önceki adımın
          // düşünme (reasoning) parçalarını geri kabul etmez. Düşünme hâlâ
          // üretilir ve arayüzde gösterilir; sadece isteğe geri eklenmez.
          prepareStep: async ({ messages: stepMessages }) => {
            step.last = withoutReasoning(stepMessages);
            return { messages: fit(step.last) };
          },
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
        const steps = await result.steps;
        const finishReason = await result.finishReason;
        const text = (await result.text).trim();

        if (!text && !sawText && finishReason !== 'tool-calls') {
          cb.onChunk('_(Model boş yanıt döndü. Modeli değiştirmeyi veya isteği kısaltmayı dene.)_');
        } else if (finishReason === 'length') {
          cb.onChunk('\n\n_⚠️ Cevap modelin çıktı sınırında kesildi. Devam etmek için "devam" yazabilirsin._');
        } else if (finishReason === 'tool-calls') {
          cb.onChunk(`\n\n_⚠️ Bu istekte ${MAX_STEPS} adım sınırına ulaştım. Kaldığım yerden sürdürmem için "devam" yaz._`);
        }

        if (memory?.onConversation) {
          const produced = await result.responseMessages;
          memory.onConversation(withoutReasoning([...messages, ...produced]));
        }

        cb.onDone({
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          costUsd: calcCost(resolved.id, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
          contextWindow: contextWindow(resolved.id),
          model: resolved.id,
          cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
          contextTokens: (steps[steps.length - 1]?.usage.inputTokens ?? 0) + (steps[steps.length - 1]?.usage.outputTokens ?? 0),
        });
        return;
      } catch (err) {
        if (signal?.aborted) {
          cb.onCancelled?.();
          return;
        }
        const raw = err instanceof Error ? err.message : String(err);
        const limit = requestLimitFrom(raw);
        if (limit !== null && shrinkRetries < 2) {
          // İstek sağlayıcının sınırından büyük: sınırı öğren, araç çıktılarını kısaltıp kaldığı yerden sür
          shrinkRetries++;
          const known = requestLimits.get(resolved.id);
          const next = limit || Math.floor((known ?? 16000) / 2);
          requestLimits.set(resolved.id, known ? Math.min(known * 0.7, next) : next);
          if (step.last) messages.splice(0, messages.length, ...step.last);
          attempt--;
          continue;
        }
        if (!isRetryable(raw) || attempt >= maxAttempts || chunkSeen) {
          cb.onError(raw);
          return;
        }
        await delay(1200 * attempt * attempt);
      }
    }
  } finally {
    offRateLimit();
  }
}

function isRetryable(message: string): boolean {
  const m = message.toLowerCase();
  // Günlük kota tükendiyse tekrar denemenin anlamı yok (saatlerce sürebilir)
  if (m.includes('exceeded your current quota') || m.includes('quota exceeded') || m.includes('billing')) {
    return false;
  }
  // Hız sınırı fetch katmanında (rateLimit.ts) zaten beklendi; turu hemen baştan almak yeni 429 getirir
  if (m.includes('rate limit') || m.includes('rate_limit') || m.includes('429')) return false;
  return (
    m.includes('503') || m.includes('502') || m.includes('500') ||
    m.includes('overloaded') || m.includes('high demand') ||
    m.includes('econnreset') || m.includes('etimedout') || m.includes('socket hang up') ||
    m.includes('fetch failed') || m.includes('network') || m.includes('rate limit')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const COMPACT_PROMPT = [
  'Görevin: aşağıdaki kodlama konuşmasını, aynı işe kaldığı yerden devam edecek bir yapay zekâ için özetlemek.',
  'Türkçe, en çok ~400 kelime, başlıklarla yaz:',
  '- Kullanıcının hedefi ve istekleri (son istek dahil)',
  '- Yapılanlar: değişen ya da oluşturulan dosyalar (yollarıyla), önemli kararlar, çalıştırılan komutların sonuçları',
  '- Önemli bulgular: hata iletileri, dosyalarda öğrenilen kritik ayrıntılar (fonksiyon adları, yapı)',
  '- Kalan işler ve sıradaki adım',
  'Kod bloklarını yalnız gerçekten gerekliyse kısa tut. Yalnız özeti yaz; açıklama ya da giriş cümlesi ekleme.',
].join('\n');

/**
 * Konuşmayı modele özetletir (Claude Code'un /compact'ı gibi). Özet, sonraki isteklerde konuşmanın yerine
 * geçer; bağlam penceresi ve dakikalık token sınırı rahatlar. Eski araç çıktıları önce budanır.
 */
export async function summarizeConversation(
  settings: TulvezSettings,
  messages: ModelMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const resolved = resolveModel(settings);
  let msgs = withoutReasoning(pruneOldToolResults(messages, 1));
  const limit = requestLimits.get(resolved.id);
  const budget = limit ? Math.max(3000, Math.floor(limit * 3 * 0.7) - COMPACT_PROMPT.length) : Math.min(contextWindow(resolved.id) * 2, 400_000);
  msgs = fitToolResults(compactConversation(msgs, budget), budget);
  const result = await generateText({
    model: resolved.model,
    system: COMPACT_PROMPT,
    messages: [...msgs, { role: 'user', content: 'Yukarıdaki konuşmayı yönergeye göre özetle.' }],
    abortSignal: signal,
    maxRetries: 1,
  });
  const text = result.text.trim();
  if (!text) throw new Error('Model boş özet döndürdü.');
  return text;
}

/** Özetin konuşmadaki yeri: sonraki isteklerde modelin gördüğü tek geçmiş */
export function compactedMessages(summary: string): ModelMessage[] {
  return [
    { role: 'user', content: `(Önceki konuşmanın özeti — bağlam sıkıştırıldı. Ayrıntı gerekirse dosyaları yeniden oku.)\n\n${summary}` },
    { role: 'assistant', content: [{ type: 'text', text: 'Anladım; özetteki bilgilerle kaldığım yerden devam ediyorum.' }] },
  ];
}

const SUBAGENT_NOTE = [
  'Sen ana ajanın başlattığı bir alt ajansın; kullanıcıyla değil, ana ajanla konuşuyorsun.',
  'Görevi araçlarla araştır (yalnız okuma). Bitince bulgularını kısa ve somut raporla: ilgili dosya yolları (satır',
  'numarasıyla), önemli fonksiyon/tip adları, sorunun cevabı. Soru sorma, onay bekleme; rapor tek yanıtın olsun.',
].join('\n');

const SUBAGENT_MAX_CHARS = 12_000;

/**
 * Alt ajan (Claude Code'un Task aracı gibi): kendi bağlamında, salt okuma araçlarıyla görevi yürütür ve son
 * metnini rapor olarak döndürür. Araç adımları ana arayüzde görünür; izin kuralları ve hook'lar aynen geçer.
 */
async function runSubagent(settings: TulvezSettings, prompt: string, cb: AgentCallbacks, signal?: AbortSignal): Promise<string> {
  if (!prompt.trim()) return 'Hata: alt ajan görevi boş.';
  let text = '';
  let error = '';
  let cancelled = false;
  await runAgent(settings, prompt, 'ask', [], {
    onChunk: (t) => { text += t; },
    onToolCall: cb.onToolCall,
    onToolResult: cb.onToolResult,
    onToolRequest: cb.onToolRequest,
    onBeforeTool: cb.onBeforeTool,
    onAfterTool: cb.onAfterTool,
    onDone: () => {},
    onCancelled: () => { cancelled = true; },
    onError: (e) => { error = e; },
  }, signal, { subagent: true });
  if (cancelled) return 'Hata: alt ajan durduruldu.';
  if (error && !text.trim()) return `Hata: alt ajan tamamlanamadı: ${error}`;
  const report = text.trim() || '(alt ajan rapor yazmadı)';
  return report.length > SUBAGENT_MAX_CHARS ? `${report.slice(0, SUBAGENT_MAX_CHARS)}\n… (rapor kısaltıldı)` : report;
}
