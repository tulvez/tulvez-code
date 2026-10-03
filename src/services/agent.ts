import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import type { TulvezSettings } from './messages';
import { calcCost, SYSTEM_PROMPTS, type AgentMode, type ChatTurn } from './ai';
import { TOOL_DEFINITIONS, executeTool } from './tools';

export interface AgentCallbacks {
  onChunk: (text: string) => void;
  onToolCall: (tool: string, summary: string) => void;
  onToolRequest: (id: string, tool: string, args: string) => Promise<boolean>;
  onDone: (usage: { inputTokens: number; outputTokens: number; costUsd: number; contextWindow: number }) => void;
  onError: (err: string) => void;
}

function contextWindow(model: string): number {
  if (model.includes('gemini')) return 1048576;
  if (model.includes('claude')) return 200000;
  if (model.includes('o1')) return 200000;
  if (model.includes('gpt-4o')) return 128000;
  if (model.includes('gpt-4')) return 8192;
  if (model.includes('llama')) return 128000;
  if (model.includes('mixtral')) return 32768;
  if (model.includes('gemma')) return 8192;
  return 128000;
}

const SUPPORTED_TOOLS = ['openai', 'groq', 'anthropic', 'gemini', 'ollama'] as const;

let toolReqCounter = 0;
const nextToolReqId = () => `tool-${Date.now()}-${toolReqCounter++}`;

function toolSummary(name: string, args: Record<string, unknown>): string {
  if (name === 'run_command') return String(args.command ?? '');
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file') return String(args.path ?? '');
  if (name === 'list_files') return String(args.directory ?? '.');
  return JSON.stringify(args).slice(0, 120);
}

async function maybeApprove(
  settings: TulvezSettings,
  cb: AgentCallbacks,
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const def = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!def?.requiresApproval || settings.autoApproveCommands) return true;
  return cb.onToolRequest(nextToolReqId(), name, JSON.stringify(args, null, 2).slice(0, 2000));
}

export async function runAgent(
  settings: TulvezSettings,
  userMessage: string,
  mode: AgentMode,
  history: ChatTurn[],
  cb: AgentCallbacks,
): Promise<void> {
  if (!SUPPORTED_TOOLS.includes(settings.aiProvider as (typeof SUPPORTED_TOOLS)[number])) {
    cb.onError('Bu sağlayıcı henüz araç desteklemiyor.');
    return;
  }
  const systemPrompt = SYSTEM_PROMPTS[mode];
  // Ask modunda yalnızca salt-okunur araçlar çalışır; yazma/komut araçları kapalı.
  const allowedTools = TOOL_DEFINITIONS.filter((t) => mode !== 'ask' || !t.requiresApproval);

  try {
    if (settings.aiProvider === 'anthropic') {
      await runAnthropic(settings, systemPrompt, userMessage, history, cb, allowedTools);
    } else if (settings.aiProvider === 'gemini') {
      await runGemini(settings, systemPrompt, userMessage, history, cb, allowedTools);
    } else {
      const baseURL =
        settings.aiProvider === 'groq' ? 'https://api.groq.com/openai/v1'
        : settings.aiProvider === 'ollama' ? `${(settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1`
        : undefined;
      await runOpenAICompatible(settings, systemPrompt, userMessage, history, cb, baseURL, allowedTools);
    }
  } catch (err) {
    cb.onError(err instanceof Error ? err.message : String(err));
  }
}

const openAIToolsFor = (tools: typeof TOOL_DEFINITIONS): OpenAI.Chat.Completions.ChatCompletionTool[] =>
  tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters as OpenAI.FunctionDefinition['parameters'] },
  }));

async function runOpenAICompatible(
  settings: TulvezSettings,
  systemPrompt: string,
  userMessage: string,
  history: ChatTurn[],
  cb: AgentCallbacks,
  baseURL?: string,
  tools: typeof TOOL_DEFINITIONS = TOOL_DEFINITIONS,
): Promise<void> {
  const apiKey = settings.aiProvider === 'ollama' ? 'ollama' : settings.apiKey;
  const isOllama = settings.aiProvider === 'ollama';
  if (!isOllama && !settings.apiKey) {
    cb.onError('API anahtarı eksik. Ayarlar\'dan ekleyin.');
    return;
  }
  const model = settings.model || (settings.aiProvider === 'groq' ? 'llama-3.3-70b-versatile' : isOllama ? 'llama3' : 'gpt-4o-mini');
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((t) => ({ role: t.role, content: t.text }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
    { role: 'user', content: userMessage },
  ];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < 10; step++) {
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages,
      tools: openAIToolsFor(tools),
    });

    let content = '';
    const partial = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        cb.onChunk(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const cur = partial.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          partial.set(tc.index, cur);
        }
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }

    if (partial.size === 0) break;

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: [...partial.values()].map((t) => ({
        id: t.id,
        type: 'function' as const,
        function: { name: t.name, arguments: t.args },
      })),
    });

    for (const t of partial.values()) {
      let args: Record<string, unknown> = {};
      try { args = t.args ? JSON.parse(t.args) : {}; } catch { args = {}; }
      cb.onToolCall(t.name, toolSummary(t.name, args));
      const allowed = await maybeApprove(settings, cb, t.name, args);
      const result = allowed
        ? await executeTool(t.name, args, settings.allowShellCommands)
        : 'Kullanıcı aracı reddetti.';
      messages.push({ role: 'tool', tool_call_id: t.id, content: result });
    }
  }

  cb.onDone({ inputTokens, outputTokens, costUsd: calcCost(model, inputTokens, outputTokens), contextWindow: contextWindow(model) });
}

async function runAnthropic(
  settings: TulvezSettings,
  systemPrompt: string,
  userMessage: string,
  history: ChatTurn[],
  cb: AgentCallbacks,
  toolDefs: typeof TOOL_DEFINITIONS = TOOL_DEFINITIONS,
): Promise<void> {
  if (!settings.apiKey) { cb.onError('Anthropic API anahtarı eksik. Ayarlar\'dan ekleyin.'); return; }
  const model = settings.model || 'claude-3-5-haiku-20241022';
  const client = new Anthropic({ apiKey: settings.apiKey });
  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: userMessage },
  ];
  const tools: Anthropic.Tool[] = toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < 10; step++) {
    const stream = client.messages.stream({ model, max_tokens: 4096, system: systemPrompt, tools, messages });
    let streamedText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        streamedText += event.delta.text;
        cb.onChunk(event.delta.text);
      }
      if (event.type === 'message_start' && event.message.usage) inputTokens = event.message.usage.input_tokens;
      if (event.type === 'message_delta' && event.usage) outputTokens = event.usage.output_tokens;
    }
    const final = await stream.finalMessage();
    inputTokens = final.usage.input_tokens;
    outputTokens = final.usage.output_tokens;

    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: final.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const args = (tu.input ?? {}) as Record<string, unknown>;
      cb.onToolCall(tu.name, toolSummary(tu.name, args));
      const allowed = await maybeApprove(settings, cb, tu.name, args);
      const result = allowed
        ? await executeTool(tu.name, args, settings.allowShellCommands)
        : 'Kullanıcı aracı reddetti.';
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
    }
    messages.push({ role: 'user', content: results });
  }

  cb.onDone({ inputTokens, outputTokens, costUsd: calcCost(model, inputTokens, outputTokens), contextWindow: contextWindow(model) });
}

async function runGemini(
  settings: TulvezSettings,
  systemPrompt: string,
  userMessage: string,
  history: ChatTurn[],
  cb: AgentCallbacks,
  toolDefs: typeof TOOL_DEFINITIONS = TOOL_DEFINITIONS,
): Promise<void> {
  if (!settings.apiKey) { cb.onError('Gemini API anahtarı eksik. Ayarlar\'dan ekleyin.'); return; }
  const model = settings.model || 'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(settings.apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: 8192 },
    tools: [{
      functionDeclarations: toolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as object,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any),
    }],
  });
  const contents: { role: string; parts: Part[] }[] = [
    ...history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] as Part[] })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < 10; step++) {
    const result = await genModel.generateContentStream({ contents });
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) cb.onChunk(text);
    }
    const response = await result.response;
    const usage = response.usageMetadata;
    inputTokens = usage?.promptTokenCount ?? inputTokens;
    outputTokens = usage?.candidatesTokenCount ?? outputTokens;

    const calls = response.functionCalls() ?? [];
    const modelParts = (response.candidates?.[0]?.content?.parts ?? []) as Part[];
    if (modelParts.length > 0) {
      contents.push({ role: 'model', parts: modelParts });
    }
    if (calls.length === 0) break;

    const parts: Part[] = [];
    for (const call of calls) {
      const args = (call.args ?? {}) as Record<string, unknown>;
      cb.onToolCall(call.name, toolSummary(call.name, args));
      const allowed = await maybeApprove(settings, cb, call.name, args);
      const content = allowed
        ? await executeTool(call.name, args, settings.allowShellCommands)
        : 'Kullanıcı aracı reddetti.';
      parts.push({ functionResponse: { name: call.name, response: { result: content } } } as Part);
    }
    contents.push({ role: 'user', parts });
  }

  cb.onDone({ inputTokens, outputTokens, costUsd: calcCost(model, inputTokens, outputTokens), contextWindow: contextWindow(model) });
}
