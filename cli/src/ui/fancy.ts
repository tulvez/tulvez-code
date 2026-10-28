import * as fs from 'fs';
import type { ToolResult } from '../../../src/services/agent';
import { preEditSnapshot, resolveEditPath, type TodoItem } from '../../../src/services/tools';
import type { Approval, SessionUi, TurnUsage } from '../session';
import { diffSummary, lineDiff } from './diff';
import { friendlyError } from './errors';
import { MarkdownStream } from './markdown';
import { print, screen, Spinner } from './screen';
import { select } from './select';
import { bg, box, c, columns, dim, fit, wrapAnsi } from './theme';

/**
 * Renkli terminal arayüzü (Claude Code düzeninde): her araç adımı "● Ad(argüman)" satırı ve altında
 * "└ sonuç"; düzenlemelerde renkli fark; düşünme göstergesi; seçmeli onaylar.
 * Tuşları (Esc ile durdurma, sıraya ekleme) giriş kutusu yönetir; bu sınıf yalnız çizer.
 */

const TOOL_NAMES: Record<string, string> = {
  read_file: 'Oku', read_files: 'Oku', list_files: 'Listele', list_dir: 'Listele', grep_files: 'Ara',
  write_file: 'Yaz', replace_in_file: 'Düzenle', run_command: 'Komut', run_in_background: 'Arka plan',
  stop_background: 'Durdur', web_fetch: 'İndir', web_search: 'Web', task: 'Alt ajan',
};

const TOOL_COLOR: Record<string, (t: string) => string> = {
  read_file: c.blue, read_files: c.blue, list_files: c.blue, list_dir: c.blue, grep_files: c.blue,
  write_file: c.green, replace_in_file: c.green,
  run_command: c.yellow, run_in_background: c.yellow, stop_background: c.yellow,
  web_fetch: c.violet, web_search: c.violet, task: c.cyan,
};

export function toolName(tool: string): string {
  return TOOL_NAMES[tool] ?? tool;
}

const DIFF_LINES = 12;
const ADD_BG = bg('#16361f');
const DEL_BG = bg('#3d1618');

function nonEmptyLines(text: string): number {
  return text.split(/\r?\n/).filter((l) => l.trim()).length;
}

/** Araç sonucunun tek satırlık özeti */
function resultSummary(tool: string, output: string, summary: string): string {
  if (tool === 'read_file') return `${nonEmptyLines(output)} satır okundu`;
  if (tool === 'read_files') return `${summary.split(',').filter((s) => s.trim()).length} dosya okundu`;
  if (tool === 'list_files' || tool === 'list_dir') return `${nonEmptyLines(output)} öğe`;
  if (tool === 'grep_files') {
    const n = output.split(/\r?\n/).filter((l) => /:\d+[:-]/.test(l)).length;
    return n ? `${n} eşleşme` : 'eşleşme yok';
  }
  if (tool === 'task') return `rapor hazır (${nonEmptyLines(output)} satır)`;
  if (tool === 'web_search') {
    const n = output.split(/\r?\n/).filter((l) => /^\d+\. /.test(l)).length;
    return n ? `${n} sonuç` : 'sonuç yok';
  }
  if (tool === 'web_fetch') return `${output.length.toLocaleString('tr-TR')} karakter indirildi`;
  return 'tamam';
}

export class FancyUi implements SessionUi {
  private spinner = new Spinner();
  private md = new MarkdownStream((line) => print(line));
  private reasoningBuf = '';
  /** Araç çağrısının özeti (sonuçta yol/argüman gerekir) */
  private calls = new Map<string, { tool: string; summary: string }>();

  begin(): void {
    this.newBlock();
    this.reasoningBuf = '';
    this.calls.clear();
    this.spinner.start();
  }

  end(): void {
    this.spinner.stop();
    this.flushReasoning();
    this.flushText();
  }

  private pause(): void {
    this.spinner.stop();
    this.flushReasoning();
  }

  /** Yarım satırı kalıcı yazar, canlı önizlemeyi kaldırır. */
  private flushText(): void {
    this.md.flush();
    screen.setSlot('stream', null);
  }

  /** Yeni yanıt bloğu (ilk satır "●" ile başlar). */
  private newBlock(): void {
    this.md.reset();
    screen.setSlot('stream', null);
  }

  text(chunk: string): void {
    this.flushReasoning();
    this.md.push(chunk);
    // Yazılmakta olan satır gösterge ile birlikte canlı görünür (satır bitince sohbete geçer)
    const peek = this.md.peek();
    screen.setSlot('stream', peek ? wrapAnsi(peek, columns() - 1, 2).slice(-4) : null);
    if (this.spinner.running) this.spinner.label = 'Yazıyor';
    else this.spinner.start('Yazıyor');
  }

  reasoning(chunk: string): void {
    // Claude Code gibi: modelin düşünme metni ekrana dökülmez (İngilizce ve uzun), yalnız gösterge
    this.reasoningBuf += chunk;
    if (this.spinner.running) this.spinner.label = 'Düşünüyor';
    else this.spinner.start('Düşünüyor');
  }

  private flushReasoning(): void {
    this.reasoningBuf = '';
  }

  todos(items: TodoItem[]): void {
    this.pause();
    this.flushText();
    print(`${c.violet('●')} ${c.text('Yapılacaklar')}`);
    items.forEach((t, i) => {
      const lead = i === 0 ? c.muted('  └ ') : '    ';
      const mark = t.status === 'completed' ? c.green('✓') : t.status === 'in_progress' ? c.yellow('◐') : c.muted('○');
      const label = t.status === 'completed' ? dim(c.muted(t.content)) : t.status === 'in_progress' ? c.text(t.content) : c.muted(t.content);
      print(`${lead}${mark} ${label}`);
    });
    this.spinner.start();
  }

  toolCall(tool: string, summary: string, callId: string): void {
    this.pause();
    this.newBlock();
    this.calls.set(callId, { tool, summary });
    const paint = TOOL_COLOR[tool] ?? c.cyan;
    const arg = summary ? c.muted(`(${fit(summary.replace(/\s*\n\s*/g, ' '), Math.max(10, columns() - 20)).trimEnd()})`) : '';
    print(`${paint('●')} ${c.text(toolName(tool))}${arg}`);
    this.spinner.start(toolName(tool));
  }

  toolResult(r: ToolResult): void {
    this.pause();
    const call = this.calls.get(r.callId);
    const lead = `  ${c.muted('└')}  `;
    if (r.status === 'rejected') {
      print(`${lead}${c.red(r.output.startsWith('Engellendi') ? fit(r.output, columns() - 8).trimEnd() : 'İzin verilmedi')}`);
    } else if (r.status === 'error') {
      const lines = r.output.trim().split(/\r?\n/);
      print(`${lead}${c.red(fit(lines[0] ?? 'hata', columns() - 8).trimEnd())}`);
      for (const l of lines.slice(1, 4)) print(`     ${dim(c.muted(fit(l, columns() - 7).trimEnd()))}`);
    } else if (r.tool === 'run_command' || r.tool === 'run_in_background') {
      const code = r.exitCode !== undefined ? `çıkış ${r.exitCode}` : 'bitti';
      print(`${lead}${r.exitCode ? c.red(code) : c.muted(code)}`);
      const lines = r.output.replace(/\s+$/, '').split(/\r?\n/).filter((l, i, a) => l || i < a.length - 1);
      for (const l of lines.slice(0, 6)) print(`     ${dim(c.muted(fit(l, columns() - 7).trimEnd()))}`);
      if (lines.length > 6) print(`     ${c.muted(`… ${lines.length - 6} satır daha`)}`);
    } else if ((r.tool === 'write_file' || r.tool === 'replace_in_file') && call) {
      this.printDiff(call.summary, lead);
    } else {
      print(`${lead}${c.muted(resultSummary(r.tool, r.output, call?.summary ?? ''))}`);
    }
    this.spinner.start();
  }

  /** Düzenlemenin önceki hali (tools snapshot'ı) ile şimdiki hali arasındaki fark */
  private printDiff(file: string, lead: string): void {
    const abs = resolveEditPath(file);
    let after = '';
    try { after = abs ? fs.readFileSync(abs, 'utf8') : ''; } catch { /* okunamadı */ }
    const before = (abs && preEditSnapshot.get(abs)) ?? '';
    const d = lineDiff(before, after);
    print(`${lead}${c.text(diffSummary(d))}`);
    // "     1234 - " = 12 sütun önek; satır terminal genişliğini aşmasın (aşan arka plan alt satıra taşar)
    const w = Math.max(10, columns() - 14);
    const rows: string[] = [];
    d.removedLines.forEach((l, i) => rows.push(`     ${c.muted(String(d.start + i).padStart(4))} ${DEL_BG(c.red(`- ${fit(l, w)}`))}`));
    d.addedLines.forEach((l, i) => rows.push(`     ${c.muted(String(d.start + i).padStart(4))} ${ADD_BG(c.green(`+ ${fit(l, w)}`))}`));
    for (const r of rows.slice(0, DIFF_LINES)) print(r);
    if (rows.length > DIFF_LINES) print(`     ${c.muted(`… ${rows.length - DIFF_LINES} satır daha`)}`);
  }

  waiting(seconds: number): void {
    // Claude Code gibi: sohbete satır yazılmaz, yalnız gösterge söyler (iş kendiliğinden sürer)
    this.spinner.stop();
    this.spinner.start(`Sağlayıcının dakikalık sınırı · ${seconds} sn bekleniyor`);
  }

  async approve(tool: string, detail: string, signal: AbortSignal): Promise<Approval | null> {
    this.pause();
    this.flushText();
    const title = tool === 'run_command' || tool === 'run_in_background' ? 'Bu komut çalıştırılsın mı?'
      : tool === 'web_fetch' ? 'Bu adres indirilsin mi?' : `${toolName(tool)} çalıştırılsın mı?`;
    // Araç satırı komutu tek satırda zaten gösterir; çok satırlı ya da sığmayan komut kutuda tam görünür
    if (detail.includes('\n') || detail.length > columns() - 24) {
      const detailLines = detail.split('\n').slice(0, 12).map((l) => c.text(l));
      for (const l of box(detailLines, { width: Math.min(columns() - 1, 100), color: c.yellow, title: c.yellow(toolName(tool)) })) print(l);
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
    if (choice !== 'hayir') print(`  ${c.muted('└')}  ${c.green(choice === 'hep' ? 'İzin verildi (bu oturumda hep)' : 'İzin verildi')}`);
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
    this.flushText();
    const secs = (u.ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
    const cost = u.costUsd > 0 ? ` · ${u.costUsd < 0.01 ? '<$0.01' : `$${u.costUsd.toFixed(2)}`}` : '';
    print();
    // Girdi: talimatlar, sohbet geçmişi ve okunan dosyalar her istekte yeniden gider; çıktı: yanıtın kendisi
    const n = (x: number): string => x.toLocaleString('tr-TR');
    const cached = u.cachedInputTokens ? `, ${n(u.cachedInputTokens)} önbellekten` : '';
    print(dim(c.muted(`  ${u.model} · ${n(u.tokens)} token (${n(u.inputTokens)} girdi${cached} · ${n(u.outputTokens)} çıktı)${cost} · ${secs} sn`)));
  }

  cancelled(): void {
    this.pause();
    this.flushText();
    print(`  ${c.muted('└')}  ${c.yellow('Durduruldu')}`);
  }

  error(message: string): void {
    this.pause();
    this.flushText();
    // Bilinen hatalar Türkçe ve ne yapılacağıyla; satırlar kesilmez, kutu genişliğinde bölünür
    const err = friendlyError(message);
    const w = Math.min(columns() - 1, 100);
    const inner = w - 4;
    const body = err.lines.flatMap((l) => wrapAnsi(c.text(l), inner));
    if (err.detail) body.push('', ...wrapAnsi(dim(c.muted(err.detail)), inner));
    for (const l of box(body, { width: w, color: c.red, title: c.red(err.title) })) print(l);
  }

  changed(files: string[], canUndo: boolean): void {
    print(`  ${c.muted('Değişen dosyalar:')} ${files.map((f) => c.text(f)).join(c.muted(', '))}${canUndo ? c.muted('  · geri almak için ') + c.brand('/undo') : ''}`);
  }

  compacting(auto: boolean): void {
    this.flushText();
    print(`${c.violet('●')} ${c.text(auto ? 'Bağlam dolmak üzere — konuşma özetleniyor' : 'Konuşma özetleniyor')}`);
    this.spinner.start('Özetliyor');
  }

  compacted(summary: string | null): void {
    this.spinner.stop();
    if (summary === null) return;
    const lines = summary.split('\n').filter((l) => l.trim());
    print(`  ${c.muted('└')}  ${c.green('Özetlendi')} ${c.muted(`· sonraki istekler bu özetle sürer (${lines.length} satır)`)}`);
    for (const l of lines.slice(0, 6)) print(`     ${dim(c.muted(fit(l, columns() - 7).trimEnd()))}`);
    if (lines.length > 6) print(`     ${c.muted(`… ${lines.length - 6} satır daha`)}`);
    print();
  }

  info(message: string): void {
    print(`  ${c.muted(message)}`);
  }

  success(message: string): void {
    print(`${c.green('✓')} ${c.text(message)}`);
  }
}
