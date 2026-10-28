import * as fs from 'fs';
import * as path from 'path';
import { setHost } from '../../src/services/host';
import { invalidateRepoMap } from '../../src/services/agent';
import type { AgentMode } from '../../src/services/types';
import pkg from '../package.json';
import { HELP, MODES, isMode, parseArgs, type CliArgs } from './args';
import { createCliHost } from './cliHost';
import { invalidateFiles, matchFiles, workspaceFiles } from './files';
import { Session } from './session';
import { configDir, loadConfig, missingKeyHint, type LoadedConfig } from './settings';
import { initSkills, syncSkillsIfStale } from './skills';
import { errorLine, note, warnLine } from './terminal';
import { banner, shortPath } from './ui/banner';
import { readInput, type Suggestion, type SuggestionSet } from './ui/editor';
import { FancyUi } from './ui/fancy';
import { startKeys, stopKeys } from './ui/keys';
import { PlainUi } from './ui/plain';
import { print } from './ui/screen';
import { select } from './ui/select';
import { pickModel, providerName, runSetup } from './ui/setup';
import { BRAND, MODE_COLOR, MODE_HINT, MODE_LABEL, bold, box, c, columns, dim, fg, gradient } from './ui/theme';

// Üçüncü parti SDK'ların Node deprecation uyarıları terminali kirletmesin
process.noDeprecation = true;

interface Command {
  name: string;
  hint: string;
  /** Argüman alır mı (öneriden seçilince gönderilmez, boşluk bırakılır) */
  arg?: boolean;
}

const COMMANDS: Command[] = [
  { name: '/yardim', hint: 'komutlar ve kısayollar' },
  { name: '/mod', hint: 'Ask, Plan ya da Build' },
  { name: '/model', hint: 'modeli değiştir' },
  { name: '/saglayici', hint: 'sağlayıcı, anahtar ve modeli yeniden kur' },
  { name: '/yeni', hint: 'sohbeti sıfırla' },
  { name: '/geri-al', hint: 'son yanıtın dosya değişikliklerini geri al' },
  { name: '/onay', hint: 'komut onaylarını aç ya da kapat' },
  { name: '/ayarlar', hint: 'etkin ayarlar' },
  { name: '/temizle', hint: 'ekranı temizle' },
  { name: '/cikis', hint: 'çık (Ctrl+D)' },
];

const ALIASES: Record<string, string> = {
  help: 'yardim', yardım: 'yardim', mode: 'mod', provider: 'saglayici', sağlayıcı: 'saglayici', new: 'yeni',
  undo: 'geri-al', config: 'ayarlar', clear: 'temizle', exit: 'cikis', quit: 'cikis', çıkış: 'cikis',
};

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function configLines(cfg: LoadedConfig, session: { settings: LoadedConfig['settings'] }, root: string): string[] {
  const s = session.settings;
  const label = (t: string): string => c.muted(t.padEnd(13));
  const keySource = cfg.keySource || (s.apiKey ? 'bu oturumda girildi' : '');
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

function resolveRoot(args: CliArgs): string {
  const root = path.resolve(args.cwd ?? process.cwd());
  let stat: fs.Stats;
  try { stat = fs.statSync(root); } catch { throw new Error(`Klasör bulunamadı: ${root}`); }
  if (!stat.isDirectory()) throw new Error(`Klasör değil: ${root}`);
  return root;
}

/** Ana dizin ya da kök dizinde çalışmak tüm diski araçlara açar: uyarılır. */
function rootWarning(root: string): string | null {
  const home = path.resolve(process.env.HOME || process.env.USERPROFILE || '');
  if (root === path.parse(root).root || root === home) {
    return `${root} geniş bir klasör: araçlar altındaki her dosyaya erişebilir. Bir proje klasöründe çalıştırman önerilir.`;
  }
  return null;
}

function hasKey(s: LoadedConfig['settings']): boolean {
  return s.aiProvider === 'ollama' || !!s.apiKey;
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

// --- Öneriler: / komutlar, @ dosyalar ---

function suggester(root: string): (text: string, cursor: number) => SuggestionSet | null {
  return (text, cursor) => {
    const before = text.slice(0, cursor);
    if (/^\/\S*$/.test(before) && !text.slice(cursor).trim()) {
      const q = before.toLowerCase();
      const items: Suggestion[] = COMMANDS.filter((cmd) => cmd.name.startsWith(q))
        .map((cmd) => ({ label: cmd.name, hint: cmd.hint, insert: cmd.arg ? `${cmd.name} ` : cmd.name, submit: !cmd.arg }));
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

// --- Etkileşimli oturum ---

const MODE_ORDER: AgentMode[] = ['build', 'plan', 'ask'];

async function interactive(session: Session, cfg: LoadedConfig, root: string): Promise<number> {
  const history = loadHistory();
  const suggest = suggester(root);
  const modeColor = (): ReturnType<typeof fg> => fg(MODE_COLOR[session.mode]);

  const footer = (): string => {
    const m = modeColor();
    const parts = [
      `${m('●')} ${m(MODE_LABEL[session.mode])}`,
      c.muted(session.settings.model || providerName(session.settings.aiProvider)),
      ...(session.settings.autoApproveCommands ? [c.yellow('» onaylar açık')] : []),
      `${c.text('⇧Tab')} ${c.muted('mod')}`,
      `${c.text('/')} ${c.muted('komutlar')}`,
      `${c.text('@')} ${c.muted('dosya')}`,
    ];
    return `  ${parts.join(c.muted('  ·  '))}`;
  };

  const showBanner = (): void => {
    for (const l of banner({
      version: pkg.version, root, provider: providerName(session.settings.aiProvider), model: session.settings.model,
      mode: session.mode, autoApprove: session.settings.autoApproveCommands,
    })) print(l);
  };

  const showHelp = (): void => {
    const cmdLines = COMMANDS.map((cmd) => `${c.brand(cmd.name.padEnd(12))}${c.muted(cmd.hint)}`);
    const keyLines = [
      ['Enter', 'gönder'], ['\\ + Enter', 'yeni satır (yapıştırma da olur)'], ['⇧Tab', 'modu değiştir (Build → Plan → Ask)'],
      ['Esc', 'yanıtı durdur · iki kez: girişi sil'], ['↑ ↓', 'önceki istekler'], ['@dosya', 'dosyayı isteğe ekle'],
      ['Ctrl+C', 'girişi sil · boşken iki kez: çık'], ['Ctrl+D', 'çık'],
    ].map(([k, v]) => `${c.text(k.padEnd(12))}${c.muted(v)}`);
    for (const l of box([bold('Komutlar'), ...cmdLines, '', bold('Kısayollar'), ...keyLines], { width: Math.min(columns() - 2, 72) })) print(` ${l}`);
    print();
  };

  const setMode = (m: AgentMode): void => {
    session.mode = m;
  };

  const chooseMode = async (): Promise<void> => {
    const m = await select<AgentMode>({
      title: 'Mod',
      summary: false,
      choices: MODES.map((x) => ({ value: x, label: MODE_LABEL[x], hint: MODE_HINT[x], color: fg(MODE_COLOR[x]) })),
      initial: MODES.indexOf(session.mode),
    });
    if (m) setMode(m);
  };

  showBanner();

  let code = 0;
  for (;;) {
    const result = await readInput({
      accent: modeColor,
      footer,
      history,
      suggest,
      placeholder: session.turns ? 'Devam et…' : 'Bir şey sor, @ ile dosya ekle, / ile komut seç',
      onShiftTab: () => {
        setMode(MODE_ORDER[(MODE_ORDER.indexOf(session.mode) + 1) % MODE_ORDER.length]);
      },
    });
    saveHistory(history);
    if (!result) continue;
    if ('exit' in result) break;
    const line = result.text.trim();
    if (!line) continue;

    if (line.startsWith('/')) {
      const [raw, ...rest] = line.slice(1).split(/\s+/);
      const cmd = ALIASES[raw] ?? raw;
      const arg = rest.join(' ').trim();
      print(`${c.muted('❯')} ${c.brand(`/${cmd}`)}${arg ? ` ${c.text(arg)}` : ''}`);
      if (cmd === 'cikis') break;
      if (cmd === 'yardim') { showHelp(); continue; }
      if (cmd === 'temizle') { process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); showBanner(); continue; }
      if (cmd === 'yeni') {
        session.reset();
        invalidateRepoMap();
        print(`${c.green('✓')} ${c.text('Yeni sohbet')}`);
        print();
        continue;
      }
      if (cmd === 'geri-al') { await session.undo(); print(); continue; }
      if (cmd === 'ayarlar') {
        for (const l of box(configLines(cfg, session, root), { width: Math.min(columns() - 2, 90), title: c.text('Ayarlar') })) print(` ${l}`);
        print();
        continue;
      }
      if (cmd === 'onay') {
        session.settings.autoApproveCommands = !session.settings.autoApproveCommands;
        print(session.settings.autoApproveCommands
          ? `${c.yellow('»')} ${c.text('Onaylar açık:')} ${c.muted('komutlar sorulmadan çalışır')}`
          : `${c.green('✓')} ${c.text('Komutlar yeniden onay soracak')}`);
        print();
        continue;
      }
      if (cmd === 'mod') {
        if (arg && isMode(arg)) setMode(arg);
        else if (arg) print(`${c.red('✗')} ${c.muted(`Geçersiz mod "${arg}" — ask, plan ya da build`)}`);
        else await chooseMode();
        print(`${fg(MODE_COLOR[session.mode])('●')} ${c.text(MODE_LABEL[session.mode])} ${c.muted(`— ${MODE_HINT[session.mode]}`)}`);
        print();
        continue;
      }
      if (cmd === 'model') {
        // Listeden seçimde özet satırını seçim kutusu yazar
        const m = arg || await pickModel(session.settings);
        if (m !== null) session.settings = { ...session.settings, model: m };
        if (arg) print(`${c.green('✓')} ${c.muted('Model')} ${c.text(arg)}`);
        print();
        continue;
      }
      if (cmd === 'saglayici') {
        const next = await runSetup(session.settings, cfg.configPath, false);
        if (next) {
          session.settings = { ...next, autoApproveCommands: session.settings.autoApproveCommands };
          session.reset();
        }
        continue;
      }
      print(`${c.red('✗')} ${c.muted(`Bilinmeyen komut /${raw} — /yardim`)}`);
      print();
      continue;
    }

    // Kullanıcının isteği, mod renginde işaretle
    const m = modeColor();
    const userLines = line.split('\n');
    print(`${m('❯')} ${c.text(userLines[0])}`);
    for (const l of userLines.slice(1)) print(`  ${c.text(l)}`);
    print();
    if (!hasKey(session.settings)) {
      print(`${c.red('✗')} ${c.muted('API anahtarı yok — /saglayici ile kur')}`);
      print();
      continue;
    }
    await session.run(line);
    invalidateRepoMap();
    invalidateFiles();
    print();
  }

  saveHistory(history);
  const turns = session.turns;
  print(`${gradient('✻', BRAND)} ${bold(gradient('Görüşürüz!', BRAND))}${turns ? c.muted(` · ${turns} istek`) : ''}`);
  await session.close();
  return code;
}

// --- Giriş ---

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    errorLine(err instanceof Error ? err.message : String(err));
    return 2;
  }
  if (args.help) { process.stdout.write(`${HELP}\n`); return 0; }
  if (args.version) { process.stdout.write(`${pkg.version}\n`); return 0; }

  let cfg: LoadedConfig;
  let root: string;
  try {
    cfg = loadConfig({ provider: args.provider, model: args.model, baseUrl: args.baseUrl, yes: args.yes });
    root = resolveRoot(args);
  } catch (err) {
    errorLine(err instanceof Error ? err.message : String(err));
    return 2;
  }
  for (const w of cfg.warnings) warnLine(w);

  if (args.showConfig) {
    if (process.stdout.isTTY) {
      for (const l of box(configLines(cfg, cfg, root), { width: Math.min(columns() - 2, 90), title: c.text('Ayarlar') })) note(` ${l}`);
    } else {
      for (const l of configLines(cfg, cfg, root)) note(l);
    }
    return 0;
  }

  setHost(createCliHost(root, cfg.file, () => invalidateRepoMap()));
  const skillsRoot = initSkills(configDir());

  const piped = await readStdin();
  const tty = !!(process.stdin.isTTY && process.stdout.isTTY);
  const isInteractive = tty && !args.prompt && !piped;

  if (isInteractive) {
    startKeys();
    try {
      const warning = rootWarning(root);
      let settings = cfg.settings;
      const firstRun = !fs.existsSync(cfg.configPath) || !hasKey(settings) ||
        (settings.aiProvider === 'custom' && !settings.baseUrl);
      if (firstRun) {
        for (const l of banner({ version: pkg.version, root, provider: providerName(settings.aiProvider), model: settings.model, mode: args.mode })) print(l);
        const next = await runSetup(settings, cfg.configPath, true);
        if (!next) {
          print(`${c.muted('Kurulum yarıda kaldı. Yeniden başlatmak için')} ${c.brand('tulvez')} ${c.muted('yaz.')}`);
          return 0;
        }
        settings = next;
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      }
      if (warning) print(`${c.yellow('!')} ${c.muted(warning)}`);
      void syncSkillsIfStale(skillsRoot).catch(() => {});
      const session = new Session(settings, root, new FancyUi(), cfg.mcpServers, args.mode, true);
      return await interactive(session, cfg, root);
    } finally {
      stopKeys();
      process.stdout.write('\x1b[?25h');
    }
  }

  // Tek istek
  const hint = hasKey(cfg.settings) ? null : missingKeyHint(cfg.settings.aiProvider);
  if (hint) {
    errorLine(hint);
    if (tty) note(dim('  Ya da yalnız `tulvez` yazarak kurulum ekranını aç.'));
    return 2;
  }
  if (cfg.settings.aiProvider === 'custom' && !cfg.settings.baseUrl) {
    errorLine('custom sağlayıcı için --base-url ya da TULVEZ_BASE_URL gerekli.');
    return 2;
  }
  const warning = rootWarning(root);
  if (warning) warnLine(warning);

  const prompt = piped.trim()
    ? `${args.prompt || 'Aşağıdaki girdiyi incele.'}\n\nGirdi:\n\`\`\`\n${piped.trim()}\n\`\`\``
    : args.prompt;
  if (!prompt) {
    errorLine('İstek yok. Kullanım: tulvez "istek" (tulvez --help)');
    return 2;
  }

  // Terminalde renkli arayüz (onaylar seçmeli); yönlendirilmiş çıktıda düz metin
  if (tty) {
    startKeys();
    try {
      const session = new Session(cfg.settings, root, new FancyUi(), cfg.mcpServers, args.mode);
      const outcome = await session.run(prompt);
      await session.close();
      return outcome === 'done' ? 0 : outcome === 'cancelled' ? 130 : 1;
    } finally {
      stopKeys();
      process.stdout.write('\x1b[?25h');
    }
  }

  const ui = new PlainUi();
  const session = new Session(cfg.settings, root, ui, cfg.mcpServers, args.mode);
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted || !session.stop()) process.exit(130);
    interrupted = true;
  });
  const outcome = await session.run(prompt);
  ui.close();
  await session.close();
  return outcome === 'done' ? 0 : outcome === 'cancelled' ? 130 : 1;
}

// Açık kalan arka plan süreçleri ya da MCP bağlantıları olay döngüsünü tutmasın diye çıkış açıktır;
// stdout boşalmadan çıkılmasın diye yazma tamamlanınca.
const exit = (code: number): void => {
  process.stdout.write('', () => process.exit(code));
};

main().then(exit, (err) => {
  stopKeys();
  process.stdout.write('\x1b[?25h');
  errorLine(err instanceof Error ? err.message : String(err));
  exit(1);
});
