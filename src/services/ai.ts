import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TulvezSettings } from './messages';
import { getInstructions } from './skills';

export type AgentMode = 'ask' | 'plan' | 'build';

const DEFAULT_IDENTITY = 'Sen Tulvez Code adlı bir VS Code yapay zeka kodlama asistanısın.';

function identity(): string {
  try {
    return getInstructions() || DEFAULT_IDENTITY;
  } catch {
    return DEFAULT_IDENTITY;
  }
}

export const SYSTEM_PROMPTS: Record<AgentMode, string> = {
  ask: `${identity()}\n\n Kısa ve net ol, gerektiğinde kod örneği ver. Dosya yazma veya komut çalıştırma isteğinde kullanıcıyı Build moduna yönlendir.`,
  plan: `${identity()}\n\n İsteği adım adım planla: önce hedef ve yaklaşım, sonra numaralı somut adımlar, riskler ve doğrulama yöntemi. Kod yazma, sadece plan üret.`,
  build: `${identity()}\n\n İsteği direkt uygularsın: gerekiyorsa dosyaları oku, doğru dosyayı düzenle, komut çalıştır. Açıklama kısa, sonuç çalışır kod olsun.`,
};

// Token başına USD maliyet tablosu (input/output)
const COST_TABLE: Record<string, { in: number; out: number }> = {
  'gpt-4o':            { in: 0.000005,  out: 0.000015 },
  'gpt-4o-mini':       { in: 0.00000015, out: 0.0000006 },
  'gpt-4-turbo':       { in: 0.00001,   out: 0.00003 },
  'o1':                { in: 0.000015,  out: 0.00006 },
  'o1-mini':           { in: 0.000003,  out: 0.000012 },
  'claude-3-5-sonnet-20241022': { in: 0.000003, out: 0.000015 },
  'claude-3-5-haiku-20241022':  { in: 0.0000008, out: 0.000004 },
  'claude-3-opus-20240229':     { in: 0.000015,  out: 0.000075 },
  'gemini-2.5-pro':    { in: 0.00000125, out: 0.00001 },
  'gemini-2.5-flash':  { in: 0.0000003, out: 0.0000025 },
  'gemini-2.5-flash-lite': { in: 0.000000075, out: 0.0000003 },
  'gemini-1.5-pro':    { in: 0.00000125, out: 0.000005 },
  'gemini-1.5-flash':  { in: 0.000000075, out: 0.0000003 },
  'gemini-2.0-flash':  { in: 0.0000001,  out: 0.0000004 },
  'llama-3.3-70b-versatile': { in: 0.00000059, out: 0.00000079 },
  'llama-3.1-8b-instant':    { in: 0.00000005, out: 0.00000008 },
  'mixtral-8x7b-32768':      { in: 0.00000024, out: 0.00000024 },
  'gemma2-9b-it':            { in: 0.0000002,  out: 0.0000002  },
};

export function calcCost(model: string, inTokens: number, outTokens: number): number {
  const t = COST_TABLE[model];
  if (!t) return 0;
  return t.in * inTokens + t.out * outTokens;
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
  onError: (err: string) => void;
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

export async function streamAI(
  settings: TulvezSettings,
  userMessage: string,
  mode: AgentMode,
  callbacks: StreamCallbacks,
  history: ChatTurn[] = [],
): Promise<void> {
  const systemPrompt = SYSTEM_PROMPTS[mode];
  const model = settings.model;

  try {
    if (settings.aiProvider === 'openai') {
      await streamOpenAI(settings.apiKey, model || 'gpt-4o-mini', systemPrompt, userMessage, callbacks, undefined, history);
    } else if (settings.aiProvider === 'anthropic') {
      await streamAnthropic(settings.apiKey, model || 'claude-3-5-haiku-20241022', systemPrompt, userMessage, callbacks, history);
    } else if (settings.aiProvider === 'gemini') {
      await streamGemini(settings.apiKey, model || 'gemini-2.5-flash', systemPrompt, userMessage, callbacks, history);
    } else if (settings.aiProvider === 'groq') {
      await streamOpenAI(settings.apiKey, model || 'llama-3.3-70b-versatile', systemPrompt, userMessage, callbacks, 'https://api.groq.com/openai/v1', history);
    } else if (settings.aiProvider === 'ollama') {
      await streamOllama(settings.ollamaUrl || 'http://localhost:11434', model || 'llama3', systemPrompt, userMessage, callbacks, history);
    } else if (settings.aiProvider === 'opencode') {
      await streamOpenAI(settings.apiKey, model || 'claude-sonnet-4-5', systemPrompt, userMessage, callbacks, 'https://opencode.ai/zen/v1', history);
    } else if (settings.aiProvider === 'custom') {
      await streamOpenAI(settings.apiKey, model || 'gpt-4o-mini', systemPrompt, userMessage, callbacks, settings.baseUrl, history);
    } else {
      callbacks.onError('Bilinmeyen sağlayıcı. Ayarlar\'dan bir sağlayıcı seçin.');
    }
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err));
  }
}

async function streamOpenAI(
  apiKey: string, model: string, system: string, user: string, cb: StreamCallbacks,
  baseURL?: string, history: ChatTurn[] = [],
): Promise<void> {
  if (!apiKey) { cb.onError(`${baseURL ? 'Groq' : 'OpenAI'} API anahtarı eksik. Ayarlar'dan ekleyin.`); return; }
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: system },
      ...history.map((t) => ({ role: t.role, content: t.text })),
      { role: 'user', content: user },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) cb.onChunk(delta);
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens;
      outputTokens = chunk.usage.completion_tokens;
    }
  }

  cb.onDone({ inputTokens, outputTokens, costUsd: calcCost(model, inputTokens, outputTokens) });
}

async function streamAnthropic(
  apiKey: string, model: string, system: string, user: string, cb: StreamCallbacks,
  history: ChatTurn[] = [],
): Promise<void> {
  if (!apiKey) { cb.onError('Anthropic API anahtarı eksik. Ayarlar\'dan ekleyin.'); return; }
  const client = new Anthropic({ apiKey });
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system,
    messages: [
      ...history.map((t) => ({ role: t.role, content: t.text })),
      { role: 'user' as const, content: user },
    ],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      cb.onChunk(event.delta.text);
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens;
    }
    if (event.type === 'message_start' && event.message.usage) {
      inputTokens = event.message.usage.input_tokens;
    }
  }

  cb.onDone({ inputTokens, outputTokens, costUsd: calcCost(model, inputTokens, outputTokens) });
}

async function streamGemini(
  apiKey: string, model: string, system: string, user: string, cb: StreamCallbacks,
  history: ChatTurn[] = [],
): Promise<void> {
  if (!apiKey) { cb.onError('Gemini API anahtarı eksik. Ayarlar\'dan ekleyin.'); return; }
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model, systemInstruction: system, generationConfig: { maxOutputTokens: 8192 } });
  const chat = genModel.startChat({
    history: history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
  });

  const result = await chat.sendMessageStream(user);
  let outputTokens = 0;

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) cb.onChunk(text);
  }

  const finalResponse = await result.response;
  const usage = finalResponse.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  outputTokens = usage?.candidatesTokenCount ?? 0;

  cb.onDone({ inputTokens, outputTokens, costUsd: calcCost(model, inputTokens, outputTokens) });
}

async function streamOllama(
  baseUrl: string, model: string, system: string, user: string, cb: StreamCallbacks,
  history: ChatTurn[] = [],
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...history.map((t) => ({ role: t.role, content: t.text })),
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    cb.onError(`Ollama bağlantı hatası: ${res.status} ${res.statusText}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) { cb.onError('Ollama stream okunamadı.'); return; }

  const decoder = new TextDecoder();
  let outputTokens = 0;
  let inputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const json = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        if (json.message?.content) cb.onChunk(json.message.content);
        if (json.done) {
          inputTokens = json.prompt_eval_count ?? 0;
          outputTokens = json.eval_count ?? 0;
        }
      } catch { /* satır JSON değil, atla */ }
    }
  }

  cb.onDone({ inputTokens, outputTokens, costUsd: 0 }); // Ollama ücretsiz
}
