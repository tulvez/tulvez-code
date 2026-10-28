import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'node:readline/promises';
import { setHost } from '../../src/services/host';
import { invalidateRepoMap } from '../../src/services/agent';
import pkg from '../package.json';
import { HELP, SESSION_HELP, isMode, parseArgs, type CliArgs } from './args';
import { createCliHost } from './cliHost';
import { configDir, loadConfig, missingKeyHint, type LoadedConfig } from './settings';
import { initSkills, syncSkillsIfStale } from './skills';
import { Session, type Ask } from './session';
import { bold, dim, errorLine, note, warnLine } from './terminal';

// Üçüncü parti SDK'ların Node deprecation uyarıları terminali kirletmesin
process.noDeprecation = true;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function showConfig(cfg: LoadedConfig, root: string): void {
  const s = cfg.settings;
  note(`${bold('Ayar dosyası')}  ${cfg.configPath}${fs.existsSync(cfg.configPath) ? '' : dim(' (yok)')}`);
  note(`${bold('Sağlayıcı')}     ${s.aiProvider}`);
  note(`${bold('Model')}         ${s.model || dim('(sağlayıcının varsayılanı)')}`);
  if (s.aiProvider === 'custom') note(`${bold('Base URL')}      ${s.baseUrl || dim('(boş)')}`);
  if (s.aiProvider === 'ollama') note(`${bold('Ollama')}        ${s.ollamaUrl}`);
  // Anahtarın kendisi asla yazılmaz; yalnız hangi değişkenden geldiği
  note(`${bold('API anahtarı')}  ${cfg.keySource ? `${cfg.keySource} değişkeninden` : dim('yok')}`);
  note(`${bold('Komutlar')}      ${s.allowShellCommands ? 'açık (her biri onay ister)' : 'kapalı'}`);
  note(`${bold('MCP')}           ${cfg.mcpServers.length ? cfg.mcpServers.map((m) => m.name).join(', ') : dim('yok')}`);
  note(`${bold('Klasör')}        ${root}`);
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

async function oneShot(session: Session, prompt: string): Promise<number> {
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted || !session.stop()) process.exit(130);
    interrupted = true;
  });
  const outcome = await session.run(prompt);
  await session.close();
  return outcome === 'done' ? 0 : outcome === 'cancelled' ? 130 : 1;
}

async function interactive(session: Session, rl: readline.Interface, cfg: LoadedConfig, root: string): Promise<number> {
  note(session.describe());
  note(dim('  /yardim komutları gösterir · Ctrl+D ile çık'));
  let lastInterrupt = 0;
  let closed = false;
  rl.on('close', () => { closed = true; });
  rl.on('SIGINT', () => {
    if (session.stop()) return;
    const now = Date.now();
    if (now - lastInterrupt < 1500) {
      rl.close();
      return;
    }
    lastInterrupt = now;
    rl.write(null, { ctrl: true, name: 'u' });
    note(dim('\n  Çıkmak için Ctrl+C\'ye yeniden bas ya da /cikis yaz.'));
    rl.prompt();
  });

  while (!closed) {
    let line: string;
    try {
      line = (await rl.question(`${bold('›')} `)).trim();
    } catch {
      break; // Ctrl+D
    }
    if (!line) continue;
    if (line.startsWith('/')) {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      if (cmd === 'cikis' || cmd === 'çıkış' || cmd === 'exit' || cmd === 'quit') break;
      if (cmd === 'yardim' || cmd === 'yardım' || cmd === 'help') { note(SESSION_HELP); continue; }
      if (cmd === 'yeni' || cmd === 'new') { session.reset(); invalidateRepoMap(); note(dim('  Yeni sohbet.')); continue; }
      if (cmd === 'geri-al' || cmd === 'undo') { await session.undo(); continue; }
      if (cmd === 'ayarlar' || cmd === 'config') { showConfig({ ...cfg, settings: session.settings }, root); continue; }
      if (cmd === 'mod' || cmd === 'mode') {
        if (!isMode(arg)) { errorLine('Kullanım: /mod ask | plan | build'); continue; }
        session.mode = arg;
        note(dim(`  Mod: ${arg}`));
        continue;
      }
      if (cmd === 'model') {
        if (!arg) { note(dim(`  Model: ${session.settings.model || '(varsayılan)'}`)); continue; }
        session.settings = { ...session.settings, model: arg };
        note(dim(`  Model: ${arg}`));
        continue;
      }
      errorLine(`Bilinmeyen komut: /${cmd} (/yardim)`);
      continue;
    }
    await session.run(line);
    invalidateRepoMap();
  }
  rl.close();
  await session.close();
  return 0;
}

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

  if (args.showConfig) { showConfig(cfg, root); return 0; }

  const hint = cfg.settings.apiKey ? null : missingKeyHint(cfg.settings.aiProvider);
  if (hint) { errorLine(hint); return 2; }
  if (cfg.settings.aiProvider === 'custom' && !cfg.settings.baseUrl) {
    errorLine('custom sağlayıcı için --base-url ya da TULVEZ_BASE_URL gerekli.');
    return 2;
  }

  const warning = rootWarning(root);
  if (warning) warnLine(warning);
  setHost(createCliHost(root, cfg.file, () => invalidateRepoMap()));
  const skillsRoot = initSkills(configDir());

  const piped = await readStdin();
  const interactiveTerminal = process.stdin.isTTY && process.stdout.isTTY && !args.prompt && !piped;

  // Onaylar yalnız girdi bir terminalse sorulabilir; boru hattında reddedilir (-y hariç)
  let rl: readline.Interface | null = null;
  const ask: Ask = async (question, signal) => {
    if (!process.stdin.isTTY) return null;
    rl ??= readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    try {
      return await rl.question(question, signal ? { signal } : {});
    } catch {
      return null;
    }
  };

  if (interactiveTerminal) {
    void syncSkillsIfStale(skillsRoot).catch(() => {});
    rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true, historySize: 200 });
    const session = new Session(cfg.settings, root, ask, cfg.mcpServers, args.mode, true);
    return interactive(session, rl, cfg, root);
  }

  const prompt = piped.trim()
    ? `${args.prompt || 'Aşağıdaki girdiyi incele.'}\n\nGirdi:\n\`\`\`\n${piped.trim()}\n\`\`\``
    : args.prompt;
  if (!prompt) {
    errorLine('İstek yok. Kullanım: tulvez "istek" (tulvez --help)');
    return 2;
  }
  const session = new Session(cfg.settings, root, ask, cfg.mcpServers, args.mode);
  const code = await oneShot(session, prompt);
  (rl as readline.Interface | null)?.close();
  return code;
}

// Açık kalan arka plan süreçleri ya da MCP bağlantıları olay döngüsünü tutmasın diye çıkış açıktır;
// stdout boşalmadan çıkılmasın diye yazma tamamlanınca.
const exit = (code: number): void => {
  process.stdout.write('', () => process.exit(code));
};

main().then(exit, (err) => {
  errorLine(err instanceof Error ? err.message : String(err));
  exit(1);
});
