import type { ModelMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseSettings } from './vsmock';

const { runAgent } = await import('../services/agent');
const { pruneOldToolResults } = await import('../services/conversation');

/**
 * Sağlayıcı önbelleği: sabit önek (talimat + araçlar + harita) her istekte aynı gider; Anthropic için
 * sistem mesajı açıkça işaretlenir. Eski turların araç çıktıları budanır.
 */

afterEach(() => vi.restoreAllMocks());

/** Sağlayıcıya giden istek gövdesini yakalar, 400 döndürüp turu bitirir. */
async function captureBody(provider: 'anthropic' | 'openai'): Promise<string> {
  const bodies: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ error: { message: 'deneme', type: 'invalid_request_error' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  });
  await runAgent({ ...baseSettings, aiProvider: provider, apiKey: 'k', model: provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o', autoApproveCommands: true },
    'bu projeyi incele', 'ask', [], {
      onChunk: () => undefined, onToolCall: () => undefined, onToolRequest: async () => true,
      onDone: () => undefined, onError: () => undefined,
    });
  return bodies[0] ?? '';
}

describe('istem önbelleği', () => {
  it('Anthropic: sistem mesajı cache_control ile işaretlenir', async () => {
    const body = JSON.parse(await captureBody('anthropic'));
    const system = JSON.stringify(body.system);
    expect(system).toContain('Şu anki modun: Ask');
    expect(system).toContain('"cache_control":{"type":"ephemeral"}');
  });

  it('art arda iki istekte sistem öneki birebir aynı (harita her istekte yeniden üretilmez)', async () => {
    const a = JSON.parse(await captureBody('openai'));
    vi.restoreAllMocks();
    const b = JSON.parse(await captureBody('openai'));
    const sys = (x: { messages?: { role: string; content: unknown }[]; input?: { role: string; content: unknown }[] }) =>
      JSON.stringify((x.messages ?? x.input ?? []).filter((m) => m.role === 'system' || m.role === 'developer'));
    expect(sys(a).length).toBeGreaterThan(100);
    expect(sys(b)).toBe(sys(a));
  });

  it('son iki turun dışındaki araç çıktıları kısaltılır; aynı girdiye hep aynı sonuç', () => {
    const turn = (n: number): ModelMessage[] => [
      { role: 'user', content: `istek ${n}` },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${n}`, toolName: 'read_file', input: { path: 'a' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${n}`, toolName: 'read_file', output: { type: 'text', value: `${n}`.repeat(5000) } }] },
    ];
    const msgs = [...turn(1), ...turn(2), ...turn(3)];
    const out = pruneOldToolResults(msgs);
    expect(JSON.stringify(out[2]).length).toBeLessThan(1000);
    expect(JSON.stringify(out[5])).toContain('2'.repeat(5000));
    expect(JSON.stringify(out[8])).toContain('3'.repeat(5000));
    expect(JSON.stringify(pruneOldToolResults(msgs))).toBe(JSON.stringify(out));
  });
});
