import * as readline from 'node:readline/promises';
import type { Approval, SessionUi, TurnUsage } from '../session';
import { cyan, dim, errorLine, formatCost, green, note, outputPreview, red, toolLabel, yellow } from '../terminal';

const yes = (answer: string | null): boolean => !!answer && /^(e|evet|y|yes)$/i.test(answer.trim());

/**
 * Düz çıktı: yanıt stdout'a, adımlar stderr'e. Çıktı yönlendirildiğinde, girdi boru hattından
 * geldiğinde ya da CI'da kullanılır. Onay yalnız girdi bir terminalse sorulur.
 */
export class PlainUi implements SessionUi {
  private atLineStart = true;
  private thinking = false;
  private rl: readline.Interface | null = null;

  private lineBreak(): void {
    if (this.thinking) {
      process.stderr.write('\n');
      this.thinking = false;
    }
    if (!this.atLineStart) {
      process.stdout.write('\n');
      this.atLineStart = true;
    }
  }

  private async ask(question: string, signal?: AbortSignal): Promise<string | null> {
    if (!process.stdin.isTTY) return null;
    this.rl ??= readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    try {
      return await this.rl.question(question, signal ? { signal } : {});
    } catch {
      return null;
    }
  }

  close(): void {
    this.rl?.close();
    this.rl = null;
  }

  begin(): void {}

  end(): void {
    this.lineBreak();
  }

  text(chunk: string): void {
    if (this.thinking) {
      process.stderr.write('\n');
      this.thinking = false;
    }
    process.stdout.write(chunk);
    this.atLineStart = chunk.endsWith('\n');
  }

  reasoning(chunk: string): void {
    if (!process.stderr.isTTY) return;
    if (!this.thinking) {
      this.lineBreak();
      process.stderr.write(dim('  düşünüyor: '));
      this.thinking = true;
    }
    process.stderr.write(dim(chunk.replace(/\s*\n\s*/g, ' ')));
  }

  todos(items: { content: string; status: string }[]): void {
    this.lineBreak();
    for (const t of items) {
      const mark = t.status === 'completed' ? green('✓') : t.status === 'in_progress' ? yellow('›') : dim('·');
      note(`  ${mark} ${t.status === 'completed' ? dim(t.content) : t.content}`);
    }
  }

  toolCall(tool: string, summary: string): void {
    this.lineBreak();
    note(cyan(`  ${toolLabel(tool)}`) + (summary ? ` ${summary}` : ''));
  }

  toolResult(r: { tool: string; status: string; output: string; exitCode?: number }): void {
    if (r.status === 'rejected') {
      note(dim('    reddedildi'));
    } else if (r.tool === 'run_command' || r.status === 'error') {
      const code = r.exitCode !== undefined ? ` (çıkış ${r.exitCode})` : '';
      note(r.status === 'error' ? red(`    hata${code}`) : dim(`    bitti${code}`));
      if (r.output.trim()) note(dim(outputPreview(r.output)));
    }
  }

  async approve(tool: string, detail: string, signal: AbortSignal): Promise<Approval | null> {
    this.lineBreak();
    note(yellow(`? ${toolLabel(tool)} izni:`));
    note(`    ${detail.split('\n').join('\n    ')}`);
    const reply = await this.ask(yellow('  Çalıştırılsın mı? [e/H] '), signal);
    if (reply === null) return null;
    return yes(reply) ? 'evet' : 'hayir';
  }

  async confirm(question: string): Promise<boolean | null> {
    const reply = await this.ask(yellow(`? ${question} [e/H] `));
    return reply === null ? null : yes(reply);
  }

  done(u: TurnUsage): void {
    this.lineBreak();
    note(dim(`  ${u.model} · ${u.tokens.toLocaleString('tr-TR')} token${formatCost(u.costUsd)}`));
  }

  cancelled(): void {
    this.lineBreak();
    note(dim('  Durduruldu.'));
  }

  error(message: string): void {
    this.lineBreak();
    errorLine(message);
  }

  changed(files: string[], canUndo: boolean): void {
    note(dim(`  Değişen dosyalar: ${files.join(', ')}${canUndo ? ' — geri almak için /geri-al' : ''}`));
  }

  info(message: string): void {
    note(dim(`  ${message}`));
  }

  success(message: string): void {
    note(green(`  ${message}`));
  }
}
