import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { invalidateRepoMap } from '../../src/services/agent';
import { shellInvocation } from '../../src/services/tools';
import type { AgentMode } from '../../src/services/types';
import pkg from '../package.json';
import { MODES, isMode } from './args';
import { invalidateFiles, matchFiles, workspaceFiles } from './files';
import type { Session } from './session';
import { KEYS_FILE, configDir, removeKey, type LoadedConfig } from './settings';
import { shortPath, welcomeView } from './ui/banner';
import { readInput, type EditorApi, type Suggestion, type SuggestionSet } from './ui/editor';
import { print, screen } from './ui/screen';
import { select } from './ui/select';
import { pickModel, providerName, runSetup } from './ui/setup';
import { MODE_COLOR, MODE_HINT, MODE_LABEL, bold, box, c, columns, dim, fg, fit, fitStart, width, type Paint } from './ui/theme';

interface Command {
  name: string;
  hint: string;
  /** Yanıt sürerken çalışamaz (sohbeti ya da sağlayıcıyı değiştirir) */
  idleOnly?: boolean;
}

export const COMMANDS: Command[] = [
  { name: '/yardim', hint: 'komutlar ve kısayollar' },
  { name: '/mod', hint: 'Ask, Plan ya da Build' },
  { name: '/model', hint: 'modeli değiştir', idleOnly: true },
  { name: '/saglayici', hint: 'sağlayıcı, anahtar ve modeli yeniden kur', idleOnly: true },
  { name: '/yeni', hint: 'yeni sohbet (boş ekran)', idleOnly: true },
  { name: '/geri-al', hint: 'son yanıtın dosya değişikliklerini geri al', idleOnly: true },
  { name: '/onay', hint: 'komut onaylarını aç ya da kapat' },
  { name: '/ayarlar', hint: 'etkin ayarlar' },
  { name: '/anahtar-sil', hint: 'bu sağlayıcının kayıtlı anahtarını sil' },
  { name: '/temizle', hint: 'ekranı temizle (sohbet hafızası kalır)', idleOnly: true },
  { name: '/cikis', hint: 'çık (Ctrl+D)' },
];

const ALIASES: Record<string, string> = {
  help: 'yardim', yardım: 'yardim', mode: 'mod', provider: 'saglayici', sağlayıcı: 'saglayici', new: 'yeni',
  undo: 'geri-al', config: 'ayarlar', clear: 'temizle', exit: 'cikis', quit: 'cikis', çıkış: 'cikis',
};

/** "?" yazınca açılan kısayol listesi (Claude Code'daki gibi) */
const SHORTCUTS: [string, string][] = [
  ['/', 'komutlar'],
  ['@', 'dosyayı isteğe ekle'],
  ['!', 'komutu doğrudan terminalde çalıştır (çıktısı modele de gider)'],
  ['#', 'notu AGENTS.md\'ye ekle (sonraki isteklerde kural olarak okunur)'],
  ['⇧Tab', 'modu değiştir: Build → Plan → Ask'],
  ['Enter', 'gönder · yanıt sürerken sıraya ekler'],
  ['Ctrl+S', 'yanıtı durdur, sıradaki ilk mesajı hemen gönder'],
  ['Esc', 'yanıtı durdur (sıradakiler kutuya geri gelir) · iki kez: girişi sil'],
  ['\\ + Enter', 'yeni satır'],
  ['↑ ↓', 'önceki istekler'],
  ['Ctrl+V', 'yapıştır (sağ tık da olur)'],
  ['Ctrl+C', 'yanıtı durdur · boşken iki kez: çık'],
];

export function hasKey(s: LoadedConfig['settings']): boolean {
  return s.aiProvider === 'ollama' || !!s.apiKey;
}

export function configLines(cfg: LoadedConfig, settings: LoadedConfig['settings'], root: string): string[] {
  const s = settings;
  const label = (t: string): string => c.muted(t.padEnd(13));
  const keySource = cfg.keySource === KEYS_FILE ? cfg.keysPath : cfg.keySource || (s.apiKey ? 'bu oturumda girildi' : '');
  return [
    `${label('Ayar dosyası')}${c.text(cfg.configPath)}${fs.existsSync(cfg.configPath) ? '' : c.muted(' (yok)')}`,
    `${label('Sağlayıcı')}${c.text(providerName(s.aiProvider))}`,
    `${label('Model')}${c.text(s.model || 'sağlayıcının varsayılanı')}`,
    ...(s.aiProvider === 'custom' ? [`${label('Adres')}${c.text(s.baseUrl || '(boş)')}`] : []),
    ...(s.aiProvider === 'ollama' ? [`${label('Ollama')}${c.text(s.ollamaUrl)}`] : []),
    // Anahtarın kendisi asla yazılmaz; yalnız nereden geldiği
    `${label('API anahtarı')}${s.aiProvider === 'ollama' ? c.muted('gerekmez') : keySource ? c.text(keySource) : c.red('yok')}`,
    `${label('Komutlar')}${!s.allowShellCommands ? c.muted('kapalı') : s.autoApproveCommands ? c.yellow('onaysız çalışır') : c.text('her biri onay ister')}`,
    `${label('MCP')}${cfg.mcpServers.length ? c.text(cfg.mcpServers.map((m) => m.name).join(', ')) : c.muted('yok')}`,
    `${label('Klasör')}${c.text(shortPath(root))}`,
  ];
}

// --- Komut geçmişi (oturumlar arası, ayar klasöründe) ---

const HISTORY_MAX = 200;

function historyFile(): string {
  return path.join(configDir(), 'gecmis.jsonl');
}

function loadHistory(): string[] {
  try {
    return fs.readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as string; } catch { return ''; } })
      .filter((x) => typeof x === 'string' && x).slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(items: string[]): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(historyFile(), items.slice(-HISTORY_MAX).map((x) => JSON.stringify(x)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch { /* geçmiş yazılamazsa oturum sürer */ }
}

// --- Öneriler: ? kısayollar, / komutlar, @ dosyalar ---

function suggester(root: string): (text: string, cursor: number) => SuggestionSet | null {
  return (text, cursor) => {
    if (text === '?') {
      return { items: SHORTCUTS.map(([k, v]) => ({ label: k, hint: v, insert: '' })), from: 0, to: 1 };
    }
    const before = text.slice(0, cursor);
    if (/^\/\S*$/.test(before) && !text.slice(cursor).trim()) {
      const q = before.toLowerCase();
      const items: Suggestion[] = COMMANDS.filter((cmd) => cmd.name.startsWith(q))
        .map((cmd) => ({ label: cmd.name, hint: cmd.hint, insert: cmd.name, submit: true }));
      return { items, from: 0, to: cursor };
    }
    const at = /(^|\s)@([^\s@]*)$/.exec(before);
    if (at) {
      const query = at[2];
      const from = cursor - query.length - 1;
      const items = matchFiles(workspaceFiles(root), query, 30)
        .map((f) => ({ label: `@${f}`, hint: f.endsWith('/') ? 'klasör' : '', insert: `@${f}${f.endsWith('/') ? '' : ' '}` }));
      return { items, from, to: cursor };
    }
    return null;
  };
}

// --- "!" kipi: komut doğrudan terminalde ---

const SHELL_OUTPUT_LINES = 20;
const SHELL_NOTE_CHARS = 4000;

function runShell(command: string, cwd: string, signal: AbortSignal): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const inv = shellInvocation(command);
    const child = spawn(inv.file, inv.args, { cwd, env: process.env, windowsVerbatimArguments: inv.windowsVerbatimArguments, windowsHide: true });
    let output = '';
    const add = (d: Buffer): void => {
      if (output.length < 200_000) output += d.toString('utf8');
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const onAbort = (): void => { child.kill(); };
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => { output += err.message; });
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      resolve({ code, output });
    });
  });
}

/** "# not" → AGENTS.md'nin sonuna madde olarak eklenir (yoksa oluşturulur). */
function remember(root: string, note: string): string {
  const file = path.join(root, 'AGENTS.md');
  const exists = fs.existsSync(file);
  const prev = exists ? fs.readFileSync(file, 'utf8') : '';
  const sep = !exists ? '# Proje notları\n\n' : prev.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${sep}- ${note}\n`, 'utf8');
  return file;
}

// --- Etkileşimli oturum ---

const MODE_ORDER: AgentMode[] = ['build', 'plan', 'ask'];

export async function interactive(session: Session, cfg: LoadedConfig, root: string): Promise<void> {
  const history = loadHistory();
  const suggest = suggester(root);
  const modeColor = (): Paint => fg(MODE_COLOR[session.mode]);

  let editor: EditorApi | null = null;
  const queue: string[] = [];
  let draining: Promise<void> | null = null;
  let shellAbort: AbortController | null = null;
  const busy = (): boolean => draining !== null;

  const accentFor = (text: string): Paint => (text.startsWith('!') ? c.pink : text.startsWith('#') ? c.violet : modeColor());

  // Durum satırı (Claude Code düzeni): solda mod ya da kip, sağda kısayol ipucu · model · klasör
  screen.setFooter(() => {
    const text = editor?.getText() ?? '';
    const m = modeColor();
    let left: string;
    if (text.startsWith('!')) left = c.pink('! komut kipi — doğrudan terminalde çalışır');
    else if (/^#(\s|$)/.test(text)) left = c.violet('# not kipi — AGENTS.md\'ye eklenir');
    else {
      left = `${m('●')} ${m(MODE_LABEL[session.mode])} ${c.muted('modu (⇧Tab)')}`;
      if (session.settings.autoApproveCommands) left += `  ${c.yellow('» onaylar açık')}`;
    }
    const right = `${c.muted('? kısayollar')}${c.muted('  ·  ')}${c.text(session.settings.model || providerName(session.settings.aiProvider))}${c.muted('  ·  ')}${c.muted(fitStart(shortPath(root), 28))}`;
    const gap = columns() - 1 - width(left) - width(right) - 2;
    return gap >= 2 ? ` ${left}${' '.repeat(gap)}${right}` : ` ${left}`;
  });
  screen.setEmptyView((w, h) => welcomeView({
    version: pkg.version, root, provider: providerName(session.settings.aiProvider),
    model: session.settings.model, mode: session.mode,
  })(w, h));

  const renderQueue = (): void => {
    if (!queue.length) { screen.setSlot('queue', null); return; }
    const w = columns() - 8;
    const lines = [`  ${c.muted('Sırada')} ${c.text(String(queue.length))} ${c.muted('mesaj · Ctrl+S: durdur ve hemen gönder · Esc: durdur, kutuya geri al')}`];
    for (const q of queue.slice(0, 3)) lines.push(`    ${c.muted('›')} ${dim(c.text(fit(q.replace(/\s*\n\s*/g, ' '), w).trimEnd()))}`);
    if (queue.length > 3) lines.push(`    ${c.muted(`… ${queue.length - 3} mesaj daha`)}`);
    screen.setSlot('queue', lines);
  };

  const stopCurrent = (): void => {
    if (shellAbort) shellAbort.abort();
    else session.stop();
  };

  const runItem = async (text: string): Promise<void> => {
    if (text.startsWith('!')) {
      const command = text.slice(1).trim();
      if (!command) return;
      print(`${c.pink('!')} ${c.text(command)}`);
      shellAbort = new AbortController();
      const { code, output } = await runShell(command, root, shellAbort.signal);
      const aborted = shellAbort.signal.aborted;
      shellAbort = null;
      const lines = output.replace(/\s+$/, '').split(/\r?\n/).filter((l, i, a) => l || i < a.length - 1);
      for (const l of lines.slice(0, SHELL_OUTPUT_LINES)) print(`  ${dim(c.muted(fit(l, columns() - 4).trimEnd()))}`);
      if (lines.length > SHELL_OUTPUT_LINES) print(`  ${c.muted(`… ${lines.length - SHELL_OUTPUT_LINES} satır daha`)}`);
      print(`  ${c.muted('└')}  ${aborted ? c.yellow('Durduruldu') : code ? c.red(`çıkış ${code}`) : c.muted('çıkış 0')}`);
      print();
      // Model bir sonraki istekte ne çalıştırıldığını ve çıktısını bilsin
      const body = output.length > SHELL_NOTE_CHARS ? `${output.slice(0, SHELL_NOTE_CHARS)}\n… (kısaltıldı)` : output;
      session.addNote(`(Not: kullanıcı terminalde kendisi şu komutu çalıştırdı: \`${command}\` — çıkış ${aborted ? 'durduruldu' : code}. Çıktı:\n\`\`\`\n${body.trim()}\n\`\`\`)`);
      invalidateFiles();
      return;
    }
    print(`${c.muted('>')} ${c.text(text.split('\n')[0])}`);
    for (const l of text.split('\n').slice(1)) print(`  ${c.text(l)}`);
    print();
    if (!hasKey(session.settings)) {
      print(`${c.red('✗')} ${c.muted('API anahtarı yok — /saglayici ile kur')}`);
      print();
      return;
    }
    await session.run(text);
    invalidateRepoMap();
    invalidateFiles();
    print();
  };

  /** Esc ile kutuya geri alınan mesaj sayısı; not, durdurulan tur yazılıp bitince düşülür */
  let restoredNote = 0;

  const drain = async (): Promise<void> => {
    try {
      while (queue.length) {
        const next = queue.shift()!;
        renderQueue();
        await runItem(next);
        if (restoredNote) {
          print(`  ${c.muted(`Sıradaki ${restoredNote} mesaj kutuya geri alındı — düzenleyip gönderebilirsin`)}`);
          print();
          restoredNote = 0;
        }
      }
    } finally {
      draining = null;
      renderQueue();
      // Yer tutucu "sıraya ekler"den "Devam et"e dönsün
      editor?.refresh();
    }
  };

  const enqueue = (text: string): void => {
    queue.push(text);
    renderQueue();
    draining ??= drain();
  };

  const showHelp = (): void => {
    const cmdLines = COMMANDS.map((cmd) => `${c.brand(cmd.name.padEnd(14))}${c.muted(cmd.hint)}`);
    const keyLines = SHORTCUTS.map(([k, v]) => `${c.text(k.padEnd(14))}${c.muted(v)}`);
    for (const l of box([bold('Komutlar'), ...cmdLines, '', bold('Kısayollar'), ...keyLines], { width: Math.min(columns() - 2, 90) })) print(` ${l}`);
    print();
  };

  const chooseMode = async (): Promise<void> => {
    const m = await select<AgentMode>({
      title: 'Mod',
      summary: false,
      choices: MODES.map((x) => ({ value: x, label: MODE_LABEL[x], hint: MODE_HINT[x], color: fg(MODE_COLOR[x]) })),
      initial: MODES.indexOf(session.mode),
    });
    if (m) session.mode = m;
  };

  /** Komut satırını sohbete yansıtır (komutun çıktısı varsa altına gelir). */
  const echo = (cmd: string, arg: string): void => {
    print(`${c.muted('>')} ${c.brand(`/${cmd}`)}${arg ? ` ${c.text(arg)}` : ''}`);
  };

  /** Eğik çizgi komutu; true dönerse oturum biter. */
  const command = async (line: string): Promise<boolean> => {
    const [raw, ...rest] = line.slice(1).split(/\s+/);
    const cmd = ALIASES[raw] ?? raw;
    const arg = rest.join(' ').trim();
    if (cmd === 'cikis') return true;
    if (busy() && COMMANDS.find((x) => x.name === `/${cmd}`)?.idleOnly) {
      print(`${c.yellow('!')} ${c.muted(`/${cmd} yanıt sürerken kullanılamaz — Esc ile durdur ya da yanıtın bitmesini bekle`)}`);
      return false;
    }
    if (cmd === 'yeni') {
      session.reset();
      invalidateRepoMap();
      screen.clearTranscript();
      return false;
    }
    if (cmd === 'temizle') { screen.clearTranscript(); return false; }
    echo(cmd, arg);
    if (cmd === 'yardim') { showHelp(); return false; }
    if (cmd === 'geri-al') { await session.undo(); print(); return false; }
    if (cmd === 'ayarlar') {
      for (const l of box(configLines(cfg, session.settings, root), { width: Math.min(columns() - 2, 90), title: c.text('Ayarlar') })) print(` ${l}`);
      print();
      return false;
    }
    if (cmd === 'onay') {
      session.settings.autoApproveCommands = !session.settings.autoApproveCommands;
      print(session.settings.autoApproveCommands
        ? `${c.yellow('»')} ${c.text('Onaylar açık:')} ${c.muted('komutlar sorulmadan çalışır')}`
        : `${c.green('✓')} ${c.text('Komutlar yeniden onay soracak')}`);
      print();
      return false;
    }
    if (cmd === 'anahtar-sil') {
      const p = session.settings.aiProvider;
      try {
        print(removeKey(cfg.keysPath, p)
          ? `${c.green('✓')} ${c.text(`${providerName(p)} anahtarı silindi`)} ${c.muted('(bu oturumda kullanılmaya devam eder)')}`
          : `${c.muted(`${providerName(p)} için kayıtlı anahtar yok.`)}`);
      } catch (err) {
        print(`${c.red('✗')} ${c.muted(err instanceof Error ? err.message : String(err))}`);
      }
      print();
      return false;
    }
    if (cmd === 'mod') {
      if (arg && isMode(arg)) session.mode = arg;
      else if (arg) print(`${c.red('✗')} ${c.muted(`Geçersiz mod "${arg}" — ask, plan ya da build`)}`);
      else await chooseMode();
      print(`${fg(MODE_COLOR[session.mode])('●')} ${c.text(MODE_LABEL[session.mode])} ${c.muted(`— ${MODE_HINT[session.mode]}`)}`);
      print();
      return false;
    }
    if (cmd === 'model') {
      // Listeden seçimde özet satırını seçim kutusu yazar
      const m = arg || await pickModel(session.settings);
      if (m !== null) session.settings = { ...session.settings, model: m };
      if (arg) print(`${c.green('✓')} ${c.muted('Model')} ${c.text(arg)}`);
      print();
      return false;
    }
    if (cmd === 'saglayici') {
      const next = await runSetup(session.settings, { config: cfg.configPath, keys: cfg.keysPath }, false);
      if (next) {
        session.settings = { ...next, autoApproveCommands: session.settings.autoApproveCommands };
        session.reset();
      }
      print();
      return false;
    }
    print(`${c.red('✗')} ${c.muted(`Bilinmeyen komut /${raw} — /yardim`)}`);
    print();
    return false;
  };

  for (;;) {
    const result = await readInput({
      accent: accentFor,
      history,
      suggest,
      placeholder: () => busy()
        ? 'Yazmaya devam et — Enter sıraya ekler, Ctrl+S durdurup hemen gönderir'
        : session.turns ? 'Devam et…' : 'Bir şey sor · @ dosya · / komutlar · ! terminal · ? kısayollar',
      bind: (api) => { editor = api; },
      onShiftTab: () => {
        session.mode = MODE_ORDER[(MODE_ORDER.indexOf(session.mode) + 1) % MODE_ORDER.length];
      },
      // Esc: yanıtı durdur; sıradaki mesajlar düzenlenmek üzere kutuya geri gelir (Claude Code gibi)
      onEscape: () => {
        if (!busy()) return false;
        const restored = queue.splice(0);
        renderQueue();
        stopCurrent();
        if (restored.length && editor) {
          editor.setText([editor.getText(), ...restored].filter((t) => t.trim()).join('\n'));
          restoredNote = restored.length;
        }
        return true;
      },
      onCtrlC: () => {
        if (!busy()) return false;
        stopCurrent();
        return true;
      },
      // Ctrl+S: kutudaki metin (varsa) sıranın başına geçer; yanıt durur, sıradaki hemen gönderilir
      onSendNow: (text) => {
        if (!busy()) return false;
        if (text.trim()) {
          queue.unshift(text.trim());
          if (history[history.length - 1] !== text) history.push(text);
          editor?.setText('');
        }
        if (!queue.length) return false;
        renderQueue();
        stopCurrent();
        return true;
      },
    });
    saveHistory(history);
    if (!result) continue;
    if ('exit' in result) break;
    const line = result.text.trim();
    if (!line) continue;

    if (line.startsWith('/')) {
      if (await command(line)) break;
      continue;
    }
    if (/^#\s*\S/.test(line) && !line.startsWith('##')) {
      const note = line.replace(/^#\s*/, '');
      try {
        const file = remember(root, note);
        print(`${c.violet('#')} ${c.text(note)}`);
        print(`  ${c.muted('└')}  ${c.muted(`${path.relative(root, file) || file} dosyasına eklendi; sonraki isteklerde kural olarak okunur`)}`);
      } catch (err) {
        print(`${c.red('✗')} ${c.muted(err instanceof Error ? err.message : String(err))}`);
      }
      print();
      continue;
    }
    enqueue(line);
  }

  // Çıkış: süren iş durdurulur, sıra atılır
  queue.length = 0;
  renderQueue();
  if (busy()) {
    stopCurrent();
    await draining;
  }
  saveHistory(history);
}
