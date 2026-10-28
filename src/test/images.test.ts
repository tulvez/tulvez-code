import type { ModelMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseSettings } from './vsmock';

const { runAgent } = await import('../services/agent');
const { pruneOldToolResults, withoutImages } = await import('../services/conversation');

/** Panodan yapıştırılan görsel modele gider; eski turlarda ve oturum kaydında yer tutucuya iner. */

afterEach(() => vi.restoreAllMocks());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('görsel ekleme', () => {
  it('görsel kullanıcı mesajıyla birlikte gider (selamlaşma sayılmaz)', async () => {
    const bodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      bodies.push(String(init?.body ?? ''));
      return new Response('{"error":{"message":"x"}}', { status: 400, headers: { 'content-type': 'application/json' } });
    });
    await runAgent({ ...baseSettings, aiProvider: 'openai', apiKey: 'k', model: 'gpt-4o', autoApproveCommands: true },
      'merhaba', 'ask', [], {
        onChunk: () => undefined, onToolCall: () => undefined, onToolRequest: async () => true,
        onDone: () => undefined, onError: () => undefined,
      }, undefined, { images: [{ data: PNG, mediaType: 'image/png' }] });
    expect(bodies[0]).toContain('data:image/png;base64,');
    expect(bodies[0]).toContain('list_dir');
  });

  it('eski turların görselleri ve kayıttaki görseller yer tutucuya iner', () => {
    const withImg = (n: number): ModelMessage => ({ role: 'user', content: [{ type: 'text', text: `istek ${n}` }, { type: 'image', image: PNG, mediaType: 'image/png' }] });
    const msgs: ModelMessage[] = [withImg(1), { role: 'assistant', content: 'a' }, withImg(2), { role: 'assistant', content: 'b' }, withImg(3)];
    const pruned = pruneOldToolResults(msgs);
    expect(JSON.stringify(pruned[0])).toContain('[görsel: önceki mesajda gönderildi]');
    expect(JSON.stringify(pruned[4])).not.toContain('önceki mesajda');
    expect(JSON.stringify(withoutImages(msgs))).not.toContain('"image"');
  });
});
