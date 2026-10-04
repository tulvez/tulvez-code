/**
 * Cline spike testi: bizim araçlarımızı Cline ajan döngüsüne bağlıyoruz.
 * Amaç: dosya yazma, arama, terminal komutu gibi gerçek işleri yapabiliyor mu?
 */
import { z } from 'zod';
import { createTool, createAgent } from '@cline/agents';
import { executeTool } from '../src/services/tools';

const tools = [
  createTool({
    name: 'write_file',
    description: 'Bir dosyaya içerik yazar.',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async (input: { path: string; content: string }) =>
      executeTool('write_file', input, true),
  }),
  createTool({
    name: 'read_file',
    description: 'Bir dosyayı okur.',
    inputSchema: z.object({ path: z.string() }),
    execute: async (input: { path: string }) => executeTool('read_file', input, false),
  }),
  createTool({
    name: 'grep_files',
    description: 'Çalışma alanında regex araması yapar.',
    inputSchema: z.object({ pattern: z.string(), include: z.string().optional() }),
    execute: async (input: { pattern: string; include?: string }) =>
      executeTool('grep_files', input, false),
  }),
  createTool({
    name: 'run_command',
    description: 'Terminal komutu çalıştırır.',
    inputSchema: z.object({ command: z.string() }),
    execute: async (input: { command: string }) => executeTool('run_command', input, true),
  }),
];

async function main(): Promise<void> {
  const agent = createAgent({
    providerId: process.env.SPIKE_PROVIDER ?? 'gemini',
    modelId: process.env.SPIKE_MODEL ?? 'gemini-2.5-flash',
    apiKey: process.env.SPIKE_KEY,
    baseUrl: process.env.SPIKE_BASE_URL || undefined,
    systemPrompt:
      'Sen Tulvez Code, kıdemli bir yazılım mühendisisin. İstenen işi doğrudan araçlarla yap.',
    tools,
  });

  const events: string[] = [];
  const result = await agent.run(process.argv[2] ?? 'merhaba', {
    onEvent: (event: { type: string }) => events.push(event.type),
  });

  console.log('--- EVENT TİPLERİ ---');
  console.log([...new Set(events)].join(', '));
  console.log('--- SONUÇ ---');
  console.log(
    typeof result === 'string'
      ? result.slice(0, 500)
      : JSON.stringify(result).slice(0, 900),
  );
}

main().catch((err) => {
  console.log('SPIKE HATASI:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});