import * as path from 'path';
import type { ModelMessage } from 'ai';
import { runAgent } from '../../src/services/agent';
import { beginCheckpoint, endCheckpoint, undoCheckpoint } from '../../src/services/checkpoint';
import { McpManager, readProjectMcp, type McpServerEntry } from '../../src/services/mcp';
import type { TulvezSettings } from '../../src/services/messages';
import type { AgentMode, ChatTurn } from '../../src/services/types';
import { bold, cyan, dim, errorLine, formatCost, green, note, outputPreview, red, toolLabel, yellow } from './terminal';

/** Kullanıcıya evet/hayır sorar; soramıyorsa (girdi terminal değil) null döner. */
export type Ask = (question: string, signal?: AbortSignal) => Promise<string | null>;

export type RunOutcome = 'done' | 'cancelled' | 'error';

const yes = (answer: string | null): boolean => !!answer && /^(e|evet|y|yes)$/i.test(answer.trim());

export class Session {
  mode: AgentMode;
  private prior: ModelMessage[] | null = null;
  private history: ChatTurn[] = [];
  private lastCheckpoint: string | null = null;
  private undoNote = '';
  private mcp: McpManager | null = null;
  private projectMcpDecided: boolean | null = null;
  private abort: AbortController | null = null;

  constructor(
    public settings: TulvezSettings,
    private readonly root: string,
    private readonly ask: Ask,
    private readonly userMcp: McpServerEntry[],
    mode: AgentMode,
    /** Etkileşimli oturumda /geri-al vardır; tek istekte ipucu verilmez. */
    private readonly interactive = false,
  ) {
    this.mode = mode;
  }

  get running(): boolean {
    return this.abort !== null;
  }

  /** Süren yanıtı durdurur; durduracak bir şey yoksa false. */
  stop(): boolean {
    if (!this.abort) return false;
    this.abort.abort();
    return true;
  }

  reset(): void {
    this.prior = null;
    this.history = [];
    this.lastCheckpoint = null;
    this.undoNote = '';
  }

  async close(): Promise<void> {
    await this.mcp?.close().catch(() => {});
  }

  private rel(file: string): string {
    const r = path.relative(this.root, file);
    return r && !r.startsWith('..') ? r : file;
  }

  /** Projedeki .mcp.json sunucuları kod çalıştırabilir: oturumda bir kez sorulur. */
  private async mcpEntries(): Promise<McpServerEntry[]> {
    const project = readProjectMcp(this.root);
    if (!project.length) return this.userMcp;
    if (this.projectMcpDecided === null) {
      if (this.settings.autoApproveCommands) {
        this.projectMcpDecided = true;
      } else {
        const names = project.map((p) => p.name).join(', ');
        const answer = await this.ask(yellow(`? Bu projenin .mcp.json dosyasında ${project.length} MCP sunucusu var (${names}). Başlatılsın mı? [e/H] `));
        this.projectMcpDecided = yes(answer);
        if (answer === null) note(dim('  Proje MCP sunucuları başlatılmadı (onay sorulamadı; -y ile izin verilir).'));
      }
    }
    return this.projectMcpDecided ? [...this.userMcp, ...project] : this.userMcp;
  }

  async run(prompt: string): Promise<RunOutcome> {
    const settings = this.settings;
    const mcpTools = this.mode === 'build'
      ? await this.mcpEntries().then((entries) => {
        if (!entries.length) return [];
        this.mcp ??= new McpManager(() => {});
        return this.mcp.toolsFor(entries, this.root);
      }).catch(() => [])
      : [];

    let text = prompt;
    if (this.undoNote) {
      text = `${this.undoNote}\n\n${text}`;
      this.undoNote = '';
    }

    const abort = new AbortController();
    this.abort = abort;
    beginCheckpoint(`cli-${Date.now()}`);

    let outcome: RunOutcome = 'done';
    let answer = '';
    let atLineStart = true;
    let thinking = false;
    const writeOut = (chunk: string): void => {
      if (thinking) {
        process.stderr.write('\n');
        thinking = false;
      }
      process.stdout.write(chunk);
      answer += chunk;
      atLineStart = chunk.endsWith('\n');
    };
    const lineBreak = (): void => {
      if (thinking) {
        process.stderr.write('\n');
        thinking = false;
      }
      if (!atLineStart) {
        process.stdout.write('\n');
        atLineStart = true;
      }
    };
    const pendingQuestion: { aborted: boolean } = { aborted: false };
    abort.signal.addEventListener('abort', () => { pendingQuestion.aborted = true; }, { once: true });

    await runAgent(settings, text, this.mode, this.history, {
      onChunk: writeOut,
      onReasoning: (chunk) => {
        if (!settings.showThinking || !process.stderr.isTTY) return;
        if (!thinking) {
          lineBreak();
          process.stderr.write(dim('  düşünüyor: '));
          thinking = true;
        }
        process.stderr.write(dim(chunk.replace(/\s*\n\s*/g, ' ')));
      },
      onTodos: (items) => {
        lineBreak();
        for (const t of items) {
          const mark = t.status === 'completed' ? green('✓') : t.status === 'in_progress' ? yellow('›') : dim('·');
          note(`  ${mark} ${t.status === 'completed' ? dim(t.content) : t.content}`);
        }
      },
      onToolCall: (tool, summary) => {
        lineBreak();
        note(cyan(`  ${toolLabel(tool)}`) + (summary ? ` ${summary}` : ''));
      },
      onToolResult: (r) => {
        if (r.status === 'rejected') {
          note(dim('    reddedildi'));
        } else if (r.tool === 'run_command' || r.status === 'error') {
          const code = r.exitCode !== undefined ? ` (çıkış ${r.exitCode})` : '';
          const head = r.status === 'error' ? red(`    hata${code}`) : dim(`    bitti${code}`);
          note(head);
          if (r.output.trim()) note(dim(outputPreview(r.output)));
        }
      },
      onToolRequest: async (_id, tool, args) => {
        lineBreak();
        let detail = args;
        try {
          const parsed = JSON.parse(args) as Record<string, unknown>;
          if (tool === 'run_command' || tool === 'run_in_background') detail = String(parsed.command ?? args);
          else if (tool === 'web_fetch') detail = String(parsed.url ?? args);
        } catch { /* ham metin gösterilir */ }
        note(yellow(`? ${toolLabel(tool)} izni:`));
        note(`    ${detail.split('\n').join('\n    ')}`);
        const reply = await this.ask(yellow('  Çalıştırılsın mı? [e/H] '), abort.signal);
        if (reply === null && !pendingQuestion.aborted) {
          note(dim('    Onay sorulamadı (girdi terminal değil); reddedildi. -y ile izin verilir.'));
        }
        return yes(reply);
      },
      onDone: (usage) => {
        lineBreak();
        const tokens = usage.inputTokens + usage.outputTokens;
        note(dim(`  ${usage.model} · ${tokens.toLocaleString('tr-TR')} token${formatCost(usage.costUsd)}`));
      },
      onCancelled: () => {
        lineBreak();
        note(dim('  Durduruldu.'));
        outcome = 'cancelled';
      },
      onError: (err) => {
        lineBreak();
        errorLine(err);
        outcome = 'error';
      },
    }, abort.signal, {
      prior: this.prior,
      onConversation: (msgs) => { this.prior = msgs; },
      mcpTools,
    });

    this.abort = null;
    const cp = await endCheckpoint();
    if (cp) {
      this.lastCheckpoint = cp.id;
      const files = cp.files.map((f) => this.rel(f)).join(', ');
      note(dim(`  Değişen dosyalar: ${files}${this.interactive ? ' — geri almak için /geri-al' : ''}`));
    }
    if (outcome === 'done') {
      this.history.push({ role: 'user', text: prompt }, { role: 'assistant', text: answer });
    } else {
      // Yarım kalan tur konuşma hafızasına girmez; düz metin geçmişe düşülür
      this.prior = null;
    }
    return outcome;
  }

  async undo(): Promise<void> {
    if (!this.lastCheckpoint) {
      note(dim('  Geri alınacak dosya değişikliği yok.'));
      return;
    }
    try {
      const r = await undoCheckpoint(this.lastCheckpoint, async (changed) => {
        const reply = await this.ask(yellow(`? Şu dosyalar yanıttan sonra değişmiş: ${changed.map((f) => this.rel(f)).join(', ')}. Geri alınca bu değişiklikler de kaybolur. Yine de geri alınsın mı? [e/H] `));
        return yes(reply);
      });
      if (r.cancelled) {
        note(dim('  Vazgeçildi.'));
        return;
      }
      this.lastCheckpoint = null;
      note(green(`  Geri alındı: ${r.restored.map((f) => this.rel(f)).join(', ')}`));
      this.undoNote = `(Not: kullanıcı önceki yanıtındaki dosya değişikliklerini geri aldı; şu dosyalar o yanıttan önceki haline döndü: ${r.restored.map((f) => this.rel(f)).join(', ')}. Bu dosyaları yeniden okumadan içerikleri hakkında varsayımda bulunma.)`;
    } catch (err) {
      errorLine(err instanceof Error ? err.message : String(err));
    }
  }

  describe(): string {
    const s = this.settings;
    return `${bold('Tulvez Code')} · ${this.mode} · ${s.aiProvider}${s.model ? ` / ${s.model}` : ''} · ${dim(this.root)}`;
  }
}
