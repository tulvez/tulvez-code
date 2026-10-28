import * as path from 'path';
import type { ModelMessage } from 'ai';
import { compactedMessages, runAgent, summarizeConversation, type ToolResult } from '../../src/services/agent';
import { beginCheckpoint, endCheckpoint, undoCheckpoint } from '../../src/services/checkpoint';
import { McpManager, readProjectMcp, type McpServerEntry } from '../../src/services/mcp';
import { mentionContext } from '../../src/services/mentions';
import type { TulvezSettings } from '../../src/services/messages';
import type { TodoItem } from '../../src/services/tools';
import type { AgentMode, ChatTurn } from '../../src/services/types';
import { newSessionId, sessionTitle, type SessionRecord } from './sessions';

export type Approval = 'evet' | 'hep' | 'hayir';

export interface TurnUsage {
  model: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  /** Girdinin sağlayıcı önbelleğinden gelen kısmı (Groq'ta dakikalık sınıra sayılmaz) */
  cachedInputTokens?: number;
  costUsd: number;
  ms: number;
}

/**
 * Oturumun ekrana dokunduğu her şey. Renkli terminal arayüzü (ui/fancy) ve boru hattı/düz çıktı
 * (ui/plain) aynı arayüzü uygular; oturum yalnız akışı yönetir.
 */
export interface SessionUi {
  /** Tur başladı (düşünme göstergesi). Durdurma tuşlarını giriş kutusu yönetir. */
  begin(): void;
  /** Tur bitti (nasıl biterse bitsin). */
  end(): void;
  text(chunk: string): void;
  reasoning(chunk: string): void;
  todos(items: TodoItem[]): void;
  toolCall(tool: string, summary: string, callId: string): void;
  toolResult(r: ToolResult): void;
  /** Sağlayıcı hız sınırı: istek bu kadar saniye bekleyip yinelenecek */
  waiting(seconds: number): void;
  /** Komut/araç izni; soramıyorsa null (girdi terminal değil). */
  approve(tool: string, detail: string, signal: AbortSignal): Promise<Approval | null>;
  /** Evet/hayır sorusu; soramıyorsa null. */
  confirm(question: string): Promise<boolean | null>;
  done(usage: TurnUsage): void;
  cancelled(): void;
  error(message: string): void;
  changed(files: string[], canUndo: boolean): void;
  info(message: string): void;
  success(message: string): void;
  /** Konuşma özetleniyor (/compact ya da otomatik); bitince özetle birlikte çağrılır */
  compacting?(auto: boolean): void;
  compacted?(summary: string | null): void;
}

/** Bağlam bu orana gelince bir sonraki istekten önce konuşma kendiliğinden özetlenir */
export const AUTO_COMPACT_RATIO = 0.8;

export type RunOutcome = 'done' | 'cancelled' | 'error';

export class Session {
  mode: AgentMode;
  /** Kayıt kimliği (--resume); yeni sohbette yenilenir */
  id = newSessionId();
  private createdAt = Date.now();
  private title = '';
  /** Son yanıttaki bağlam doluluğu (son adımın girdi + çıktısı) ve modelin bağlam penceresi */
  contextTokens = 0;
  contextWindow = 0;
  /** Tamamlanan her yanıttan sonra çağrılır (oturum kaydı) */
  onSaved: ((record: SessionRecord) => void) | null = null;
  private prior: ModelMessage[] | null = null;
  private history: ChatTurn[] = [];
  private lastCheckpoint: string | null = null;
  /** Sonraki isteğin başına eklenecek bağlam notları (geri alma, "!" ile çalıştırılan komutlar) */
  private notes: string[] = [];
  private mcp: McpManager | null = null;
  private projectMcpDecided: boolean | null = null;
  private abort: AbortController | null = null;

  constructor(
    public settings: TulvezSettings,
    readonly root: string,
    private readonly ui: SessionUi,
    private readonly userMcp: McpServerEntry[],
    mode: AgentMode,
    /** Etkileşimli oturumda /undo vardır; tek istekte ipucu verilmez. */
    private readonly interactive = false,
  ) {
    this.mode = mode;
  }

  get running(): boolean {
    return this.abort !== null;
  }

  get turns(): number {
    return this.history.length / 2;
  }

  /** Süren yanıtı durdurur; durduracak bir şey yoksa false. */
  stop(): boolean {
    if (!this.abort) return false;
    this.abort.abort();
    return true;
  }

  reset(): void {
    this.id = newSessionId();
    this.createdAt = Date.now();
    this.title = '';
    this.prior = null;
    this.history = [];
    this.contextTokens = 0;
    this.lastCheckpoint = null;
    this.notes = [];
  }

  /** Kaydedilecek hali */
  record(): SessionRecord {
    return {
      id: this.id, root: this.root, title: this.title, createdAt: this.createdAt, updatedAt: Date.now(),
      mode: this.mode, model: this.settings.model, history: this.history, prior: this.prior,
    };
  }

  /** Kayıttan sürdürür: konuşma hafızası ve kimlik geri gelir (sonraki yanıtlar aynı kayda yazılır). */
  restore(r: SessionRecord): void {
    this.reset();
    this.id = r.id;
    this.createdAt = r.createdAt;
    this.title = r.title;
    this.history = r.history.slice();
    this.prior = r.prior;
    this.mode = r.mode;
  }

  /** Düz metin geçmiş (ekranda yeniden göstermek için) */
  get transcript(): readonly ChatTurn[] {
    return this.history;
  }

  /** Bir sonraki isteğe modelin bilmesi gereken bağlamı ekler. */
  addNote(note: string): void {
    this.notes.push(note);
  }

  async close(): Promise<void> {
    await this.mcp?.close().catch(() => {});
  }

  rel(file: string): string {
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
        const answer = await this.ui.confirm(`Bu projenin .mcp.json dosyasında ${project.length} MCP sunucusu var (${names}). Başlatılsın mı?`);
        this.projectMcpDecided = answer === true;
        if (answer === null) this.ui.info('Proje MCP sunucuları başlatılmadı (onay sorulamadı; -y ile izin verilir).');
      }
    }
    return this.projectMcpDecided ? [...this.userMcp, ...project] : this.userMcp;
  }

  /** Bağlamın dolu kısmı (0–1); bilinmiyorsa 0 */
  get contextRatio(): number {
    return this.contextWindow ? this.contextTokens / this.contextWindow : 0;
  }

  /**
   * Konuşmayı modele özetletir; özet sonraki isteklerde konuşmanın yerine geçer (Claude Code /compact).
   * Ekranda önceki sohbet kalır. Başarısızsa konuşma olduğu gibi kalır.
   */
  async compact(auto = false): Promise<boolean> {
    const messages: ModelMessage[] = this.prior?.length
      ? this.prior
      : this.history.map<ModelMessage>((t) => (t.role === 'user'
        ? { role: 'user', content: t.text }
        : { role: 'assistant', content: [{ type: 'text', text: t.text }] }));
    if (!messages.length) {
      this.ui.info('Özetlenecek konuşma yok.');
      return false;
    }
    const abort = new AbortController();
    this.abort = abort;
    this.ui.compacting?.(auto);
    try {
      const summary = await summarizeConversation(this.settings, messages, abort.signal);
      this.prior = compactedMessages(summary);
      this.history = [{ role: 'user', text: '(önceki konuşma özetlendi)' }, { role: 'assistant', text: summary }];
      this.contextTokens = Math.round(summary.length / 3.5);
      this.ui.compacted?.(summary);
      try { this.onSaved?.(this.record()); } catch { /* kayıt yazılamazsa oturum sürer */ }
      return true;
    } catch (err) {
      this.ui.compacted?.(null);
      if (abort.signal.aborted) this.ui.cancelled();
      else this.ui.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this.abort = null;
    }
  }

  async run(prompt: string): Promise<RunOutcome> {
    // Bağlam dolmak üzereyse önce konuşma özetlenir (Claude Code'un otomatik sıkıştırması)
    if (this.contextRatio >= AUTO_COMPACT_RATIO) await this.compact(true);

    const mcpTools = this.mode === 'build'
      ? await this.mcpEntries().then((entries) => {
        if (!entries.length) return [];
        this.mcp ??= new McpManager(() => {});
        return this.mcp.toolsFor(entries, this.root);
      }).catch(() => [])
      : [];

    let text = prompt;
    const mentioned = await mentionContext(prompt, this.root).catch(() => '');
    if (mentioned) text = `${text}\n\n${mentioned}`;
    if (this.notes.length) {
      text = `${this.notes.join('\n\n')}\n\n${text}`;
      this.notes = [];
    }

    const abort = new AbortController();
    this.abort = abort;
    const started = Date.now();
    beginCheckpoint(`cli-${started}`);

    let outcome: RunOutcome = 'done';
    let answer = '';
    this.ui.begin();
    try {
      await runAgent(this.settings, text, this.mode, this.history, {
        onChunk: (chunk) => {
          answer += chunk;
          this.ui.text(chunk);
        },
        onReasoning: (chunk) => {
          if (this.settings.showThinking) this.ui.reasoning(chunk);
        },
        onTodos: (items) => this.ui.todos(items),
        onToolCall: (tool, summary, callId) => this.ui.toolCall(tool, summary, callId),
        onToolResult: (r) => this.ui.toolResult(r),
        onRateLimitWait: (seconds) => this.ui.waiting(seconds),
        onToolRequest: async (_id, tool, args) => {
          let detail = args;
          try {
            const parsed = JSON.parse(args) as Record<string, unknown>;
            if (tool === 'run_command' || tool === 'run_in_background') detail = String(parsed.command ?? args);
            else if (tool === 'web_fetch') detail = String(parsed.url ?? args);
          } catch { /* ham metin gösterilir */ }
          const reply = await this.ui.approve(tool, detail, abort.signal);
          if (reply === null && !abort.signal.aborted) {
            this.ui.info('Onay sorulamadı (girdi terminal değil); reddedildi. -y ile izin verilir.');
          }
          // "Bu oturumda bir daha sorma": ajan aynı ayar nesnesini okuduğu için sıradaki araçlar sorulmaz
          if (reply === 'hep') this.settings.autoApproveCommands = true;
          return reply === 'evet' || reply === 'hep';
        },
        onDone: (usage) => {
          if (usage.contextTokens) this.contextTokens = usage.contextTokens;
          this.contextWindow = usage.contextWindow;
          this.ui.done({
            model: usage.model,
            tokens: usage.inputTokens + usage.outputTokens,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            costUsd: usage.costUsd,
            ms: Date.now() - started,
          });
        },
        onCancelled: () => {
          this.ui.cancelled();
          outcome = 'cancelled';
        },
        onError: (err) => {
          this.ui.error(err);
          outcome = 'error';
        },
      }, abort.signal, {
        prior: this.prior,
        onConversation: (msgs) => { this.prior = msgs; },
        mcpTools,
      });
    } finally {
      this.abort = null;
      this.ui.end();
    }

    const cp = await endCheckpoint();
    if (cp) {
      this.lastCheckpoint = cp.id;
      this.ui.changed(cp.files.map((f) => this.rel(f)), this.interactive);
    }
    if (outcome === 'done') {
      this.history.push({ role: 'user', text: prompt }, { role: 'assistant', text: answer });
      if (!this.title) this.title = sessionTitle(prompt);
      try { this.onSaved?.(this.record()); } catch { /* kayıt yazılamazsa oturum sürer */ }
    } else {
      // Yarım kalan tur konuşma hafızasına girmez; düz metin geçmişe düşülür
      this.prior = null;
    }
    return outcome;
  }

  async undo(): Promise<void> {
    if (!this.lastCheckpoint) {
      this.ui.info('Geri alınacak dosya değişikliği yok.');
      return;
    }
    try {
      const r = await undoCheckpoint(this.lastCheckpoint, async (changed) => {
        const reply = await this.ui.confirm(`Şu dosyalar yanıttan sonra değişmiş: ${changed.map((f) => this.rel(f)).join(', ')}. Geri alınca bu değişiklikler de kaybolur. Yine de geri alınsın mı?`);
        return reply === true;
      });
      if (r.cancelled) {
        this.ui.info('Vazgeçildi.');
        return;
      }
      this.lastCheckpoint = null;
      const files = r.restored.map((f) => this.rel(f)).join(', ');
      this.ui.success(`Geri alındı: ${files}`);
      this.notes.push(`(Not: kullanıcı önceki yanıtındaki dosya değişikliklerini geri aldı; şu dosyalar o yanıttan önceki haline döndü: ${files}. Bu dosyaları yeniden okumadan içerikleri hakkında varsayımda bulunma.)`);
    } catch (err) {
      this.ui.error(err instanceof Error ? err.message : String(err));
    }
  }
}
