import * as fs from 'fs';
import * as path from 'path';
import { setHost } from '../../src/services/host';
import { invalidateRepoMap } from '../../src/services/agent';
import pkg from '../package.json';
import { HELP, parseArgs, type CliArgs } from './args';
import { createCliHost } from './cliHost';
import { configLines, hasKey, interactive } from './interactive';
import { Session } from './session';
import { configDir, loadConfig, missingKeyHint, type LoadedConfig } from './settings';
import { initSkills, syncSkillsIfStale } from './skills';
import { errorLine, note, warnLine } from './terminal';
import { welcomeView } from './ui/banner';
import { FancyUi } from './ui/fancy';
import { PlainUi } from './ui/plain';
import { print, screen } from './ui/screen';
import { askMissingKey, providerName, runSetup } from './ui/setup';
import { BRAND, bold, box, c, columns, gradient } from './ui/theme';

// Üçüncü parti SDK'ların Node deprecation uyarıları terminali kirletmesin
process.noDeprecation = true;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
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
    const lines = configLines(cfg, cfg.settings, root);
    if (process.stdout.isTTY) for (const l of box(lines, { width: Math.min(columns() - 2, 90), title: c.text('Ayarlar') })) note(` ${l}`);
    else for (const l of lines) note(l);
    return 0;
  }

  setHost(createCliHost(root, cfg.file, () => invalidateRepoMap()));
  const skillsRoot = initSkills(configDir());

  const piped = await readStdin();
  const tty = !!(process.stdin.isTTY && process.stdout.isTTY);

  if (tty && !args.prompt && !piped) {
    // Kütüphanelerin console çıktısı ekran yerine oturum günlüğüne
    const logFile = path.join(configDir(), 'cli.log');
    screen.start((text) => {
      fs.mkdirSync(configDir(), { recursive: true });
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`, { mode: 0o600 });
    });
    let turns = 0;
    try {
      let settings = cfg.settings;
      // Kurulum hiç yapılmadıysa baştan; sağlayıcı kayıtlı ama anahtar yoksa yalnız anahtar sorulur
      const configured = fs.existsSync(cfg.configPath) && !!cfg.file.provider &&
        !(settings.aiProvider === 'custom' && !settings.baseUrl);
      if (!configured || !hasKey(settings)) {
        screen.setEmptyView(welcomeView({
          version: pkg.version, root, provider: providerName(settings.aiProvider), model: settings.model, mode: args.mode, setup: true,
        }));
        const next = configured
          ? await askMissingKey(settings, cfg.keysPath)
          : await runSetup(settings, { config: cfg.configPath, keys: cfg.keysPath }, true);
        if (!next) {
          screen.stop();
          note(`${c.muted('Kurulum yarıda kaldı. Yeniden başlatmak için')} ${c.brand('tulvez')} ${c.muted('yaz.')}`);
          return 0;
        }
        settings = next;
      }
      const warning = rootWarning(root);
      if (warning) print(`${c.yellow('!')} ${c.muted(warning)}`);
      void syncSkillsIfStale(skillsRoot).catch(() => {});
      const session = new Session(settings, root, new FancyUi(), cfg.mcpServers, args.mode, true);
      session.permissions = cfg.file.permissions;
      session.hooks = cfg.file.hooks ?? {};
      await interactive(session, cfg, root, { continueLast: args.continueLast, resume: args.resume });
      turns = session.turns;
      await session.close();
    } finally {
      screen.stop();
    }
    note(`${gradient('✻', BRAND)} ${bold(gradient('Görüşürüz!', BRAND))}${turns ? c.muted(` · ${turns} istek`) : ''}`);
    return 0;
  }

  // Tek istek: tam ekran açılmaz; çıktı terminal geçmişinde kalır
  const hint = hasKey(cfg.settings) ? null : missingKeyHint(cfg.settings.aiProvider);
  if (hint) {
    errorLine(hint);
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

  const ui = new PlainUi();
  const session = new Session(cfg.settings, root, ui, cfg.mcpServers, args.mode);
  session.permissions = cfg.file.permissions;
  session.hooks = cfg.file.hooks ?? {};
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
  screen.stop();
  errorLine(err instanceof Error ? err.message : String(err));
  exit(1);
});
