import type { ToolResult } from '../../../src/services/agent';
import type { TodoItem } from '../../../src/services/tools';
import type { Approval, SessionUi, TurnUsage } from '../session';
import { toolLabel } from '../terminal';
import { isCtrlC, pushKeys } from './keys';
import { MarkdownStream } from './markdown';
import { print, screen, Spinner } from './screen';
import { select } from './select';
import { box, c, columns, dim, fit, italic } from './theme';

/** Araç adımları: renkli nokta + Ad(özet), sonucu altında "└" ile (her yazı tipinde bulunan çizgi karakteri). */
const TOOL_COLOR: Record<string, (t: string) => string> = {
  read_file: c.blue, read_files: c.blue, list_files: c.blue, list_dir: c.blue, grep_files: c.blue,
  write_file: c.green, replace_in_file: c.green,
  run_command: c.yellow, run_in_background: c.yellow, stop_background: c.yellow,
  web_fetch: c.violet,
};

function lineCount(text: string): number {
  return text.replace(/\s+$/, '').split(/\r?\n/).length;
}

/**
 * Renkli terminal arayüzü: düşünme göstergesi, biçimlendirilmiş yanıt, araç adımları,
 * seçmeli onaylar. Yalnız giriş ve çıkış bir terminalse kullanılır.
 */
export class FancyUi implements SessionUi {
  private spinner = new Spinner();
  private md = new MarkdownStream((line) => print(line));
  private releaseKeys: (() => void) | null = null;
  private reasoningBuf = '';

  begin(stop: () => void): void {
    this.md.reset();
    this.reasoningBuf = '';
    this.releaseKeys = pushKeys((_ch, key) => {
      if (key.name === 'escape' || isCtrlC(key)) stop();
    });
    this.spinner.start();
  }

  end(): void {
    this.spinner.stop();
    this.flushReasoning();
    this.md.flush();
    this.releaseKeys?.();
    this.releaseKeys = null;
  }

  private pause(): void {
    this.spinner.stop();
    this.flushReasoning();
  }

  text(chunk: string): void {
    if (this.spinner.running) this.pause();
    this.md.push(chunk);
  }

  reasoning(chunk: string): void {
    // Düşünme metni göstergenin etiketinde kısaca görünür, tamamı sönük bir blok olarak yazılır
    this.reasoningBuf += chunk;
    const last = this.reasoningBuf.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/).pop() ?? '';
    if (this.spinner.running) this.spinner.label = fit(last, Math.max(10, columns() - 30)).trimEnd();
  }

  private flushReasoning(): void {
    const text = this.reasoningBuf.trim();
    this.reasoningBuf = '';
    if (!text) return;
    const lines = text.split(/\n+/).slice(0, 6);
    print(`${c.muted('✻')} ${italic(dim(c.muted(fit(lines[0], columns() - 4).trimEnd())))}`);
    for (const l of lines.slice(1)) print(`  ${italic(dim(c.muted(fit(l, columns() - 4).trimEnd())))}`);
  }

  todos(items: TodoItem[]): void {
    this.pause();
    this.md.flush();
    print(`${c.violet('●')} ${c.text('Yapılacaklar')}`);
    items.forEach((t, i) => {
      const lead = i === 0 ? c.muted('  └ ') : '    ';
      const mark = t.status === 'completed' ? c.green('✓') : t.status === 'in_progress' ? c.yellow('◐') : c.muted('○');
      const label = t.status === 'completed' ? dim(c.muted(t.content)) : t.status === 'in_progress' ? c.text(t.content) : c.muted(t.content);
      print(`${lead}${mark} ${label}`);
    });
    this.spinner.start();
  }

  toolCall(tool: string, summary: string): void {
    this.pause();
    this.md.reset();
    const paint = TOOL_COLOR[tool] ?? c.cyan;
    const s = summary ? c.muted(`(${fit(summary.replace(/\s*\n\s*/g, ' '), Math.max(10, columns() - 20)).trimEnd()})`) : '';
    print(`${paint('●')} ${c.text(toolLabel(tool))}${s}`);
    this.spinner.start(`${toolLabel(tool)}`);
  }

  toolResult(r: ToolResult): void {
    this.pause();
    let line: string;
    if (r.status === 'rejected') line = c.red('Reddedildi');
    else if (r.tool === 'run_command' || r.tool === 'run_in_background') {
      const code = r.exitCode !== undefined ? `çıkış ${r.exitCode}` : 'bitti';
      line = r.status === 'error' ? c.red(code) : c.muted(code);
    } else if (r.status === 'error') line = c.red(fit(r.output.split('\n')[0], columns() - 8).trimEnd());
    else if (r.tool === 'write_file' || r.tool === 'replace_in_file') line = c.green('Kaydedildi');
    else line = c.muted(`${lineCount(r.output)} satır`);
    print(`  ${c.muted('└')}  ${line}`);
    if ((r.tool === 'run_command' || r.status === 'error') && r.status !== 'rejected' && r.output.trim()) {
      const lines = r.output.replace(/\s+$/, '').split(/\r?\n/);
      for (const l of lines.slice(0, 5)) print(`     ${dim(c.muted(fit(l, columns() - 7).trimEnd()))}`);
      if (lines.length > 5) print(`     ${c.muted(`… ${lines.length - 5} satır daha`)}`);
    }
    this.spinner.start();
  }

  async approve(tool: string, detail: string, signal: AbortSignal): Promise<Approval | null> {
    this.pause();
    this.md.flush();
    const title = tool === 'run_command' || tool === 'run_in_background' ? 'Bu komut çalıştırılsın mı?'
      : tool === 'web_fetch' ? 'Bu adres indirilsin mi?' : `${toolLabel(tool)} çalıştırılsın mı?`;
    // Araç satırı komutu tek satırda zaten gösterir; çok satırlı ya da sığmayan komut kutuda tam görünür
    if (detail.includes('\n') || detail.length > columns() - 24) {
      const detailLines = detail.split('\n').slice(0, 12).map((l) => c.text(l));
      for (const l of box(detailLines, { width: Math.min(columns() - 1, 100), color: c.yellow, title: c.yellow(toolLabel(tool)) })) print(l);
    }
    const onAbort = (): void => screen.setSlot('select', null);
    signal.addEventListener('abort', onAbort, { once: true });
    const answer = await select<Approval>({
      title,
      accent: c.yellow,
      summary: false,
      choices: [
        { value: 'evet', label: 'Evet' },
        { value: 'hep', label: 'Evet, bu oturumda bir daha sorma', hint: 'sonraki komutlar sorulmadan çalışır' },
        { value: 'hayir', label: 'Hayır', hint: 'Esc' },
      ],
    });
    signal.removeEventListener('abort', onAbort);
    const choice = answer ?? 'hayir';
    print(`  ${c.muted('└')}  ${choice === 'hayir' ? c.red('İzin verilmedi') : c.green(choice === 'hep' ? 'İzin verildi (bu oturumda hep)' : 'İzin verildi')}`);
    if (choice !== 'hayir') this.spinner.start();
    return choice;
  }

  async confirm(question: string): Promise<boolean | null> {
    const running = this.spinner.running;
    this.pause();
    const answer = await select<boolean>({
      title: question,
      accent: c.yellow,
      choices: [{ value: true, label: 'Evet' }, { value: false, label: 'Hayır' }],
      initial: 1,
    });
    if (running) this.spinner.start();
    return answer === true;
  }

  done(u: TurnUsage): void {
    this.pause();
    this.md.flush();
    const secs = (u.ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
    const cost = u.costUsd > 0 ? ` · ${u.costUsd < 0.01 ? '<$0.01' : `$${u.costUsd.toFixed(2)}`}` : '';
    print();
    print(dim(c.muted(`  ${u.model} · ${u.tokens.toLocaleString('tr-TR')} token${cost} · ${secs} sn`)));
  }

  cancelled(): void {
    this.pause();
    this.md.flush();
    print(`  ${c.muted('└')}  ${c.yellow('Durduruldu')}`);
  }

  error(message: string): void {
    this.pause();
    this.md.flush();
    for (const l of box(message.split('\n').slice(0, 8).map((m) => c.text(m)), { width: Math.min(columns() - 1, 100), color: c.red, title: c.red('Hata') })) print(l);
  }

  changed(files: string[], canUndo: boolean): void {
    print(`${c.green('●')} ${c.text('Değişen dosyalar')} ${c.muted(`(${files.length})`)}`);
    print(`  ${c.muted('└')}  ${files.map((f) => c.text(f)).join(c.muted(', '))}${canUndo ? c.muted('  · geri almak için ') + c.brand('/geri-al') : ''}`);
  }

  info(message: string): void {
    print(`  ${c.muted(message)}`);
  }

  success(message: string): void {
    print(`${c.green('✓')} ${c.text(message)}`);
  }
}
