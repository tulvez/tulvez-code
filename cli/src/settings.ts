import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TulvezSettings } from '../../src/services/messages';
import { parseMcpServers, type McpServerEntry } from '../../src/services/mcp';

/**
 * CLI ayarları üç kaynaktan, artan öncelikle: ayar dosyası → ortam değişkenleri → komut satırı.
 *
 * API anahtarı önce ortam değişkeninden, yoksa ayrı anahtar dosyasından (anahtarlar.json, yalnız
 * sahibi okuyabilir: 600) okunur. cli.json'daki anahtar alanları hiçbir zaman kullanılmaz.
 */

export type Provider = TulvezSettings['aiProvider'];

export const PROVIDERS: readonly Provider[] = ['openai', 'anthropic', 'gemini', 'groq', 'opencode', 'ollama', 'custom'];

/** Sağlayıcının anahtarını taşıyan ortam değişkenleri (ilk dolu olan kullanılır). */
export const KEY_ENV: Record<Provider, string[]> = {
  openai: ['TULVEZ_API_KEY', 'OPENAI_API_KEY'],
  anthropic: ['TULVEZ_API_KEY', 'ANTHROPIC_API_KEY'],
  gemini: ['TULVEZ_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  groq: ['TULVEZ_API_KEY', 'GROQ_API_KEY'],
  opencode: ['TULVEZ_API_KEY', 'OPENCODE_API_KEY'],
  ollama: ['TULVEZ_API_KEY'],
  custom: ['TULVEZ_API_KEY'],
};

/** Ayar dosyasının biçimi (cli.json). Anahtar alanı bilinçli olarak yok. */
export interface CliConfigFile {
  provider?: Provider;
  model?: string;
  baseUrl?: string;
  ollamaUrl?: string;
  /** Build modunda terminal komutları (her biri yine onay ister). Varsayılan açık. */
  allowShellCommands?: boolean;
  gitCoAuthor?: boolean;
  showThinking?: boolean;
  skillsRegistry?: string;
  /** Eklentideki tulvez.mcpServers ile aynı biçim */
  mcpServers?: unknown;
}

export interface CliFlags {
  provider?: string;
  model?: string;
  baseUrl?: string;
  yes?: boolean;
}

export interface LoadedConfig {
  settings: TulvezSettings;
  file: CliConfigFile;
  configPath: string;
  /** Anahtarın kaynağı: ortam değişkeninin adı ya da "anahtarlar.json"; yoksa boş */
  keySource: string;
  keysPath: string;
  mcpServers: McpServerEntry[];
  warnings: string[];
}

export function configDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.TULVEZ_CONFIG_DIR) return env.TULVEZ_CONFIG_DIR;
  if (platform === 'win32') return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'tulvez');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'tulvez');
}

export function configPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return path.join(configDir(env, platform), 'cli.json');
}

export const KEYS_FILE = 'anahtarlar.json';

export function keysPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return path.join(configDir(env, platform), KEYS_FILE);
}

/** Kayıtlı anahtarlar (sağlayıcı → anahtar); dosya yoksa ya da bozuksa boş. */
export function readSavedKeys(file: string): Partial<Record<Provider, string>> {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown;
    if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
    const out: Partial<Record<Provider, string>> = {};
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (isProvider(k) && typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Anahtar dosyasını yalnız sahibinin okuyabileceği izinle (600) yazar: önce geçici dosya, sonra
 * yeniden adlandırma; yarım yazılmış dosya kalmaz. Windows'ta dosya kullanıcının kendi profilinde durur.
 */
function writeKeys(file: string, keys: Partial<Record<Provider, string>>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(keys, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows: izin bitleri yok */ }
}

export function saveKey(file: string, provider: Provider, key: string): void {
  writeKeys(file, { ...readSavedKeys(file), [provider]: key.trim() });
}

/** Sağlayıcının kayıtlı anahtarını siler; silinecek yoksa false. */
export function removeKey(file: string, provider: Provider): boolean {
  const keys = readSavedKeys(file);
  if (!keys[provider]) return false;
  delete keys[provider];
  writeKeys(file, keys);
  return true;
}

function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

/** Ayar dosyasını okur; yoksa boş, bozuksa uyarıyla boş döner. */
export function readConfigFile(file: string, warnings: string[]): CliConfigFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    warnings.push(`${file} okunamadı (geçerli JSON değil); ayar dosyası yok sayıldı.`);
    return {};
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    warnings.push(`${file} bir JSON nesnesi değil; yok sayıldı.`);
    return {};
  }
  const obj = json as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (/key|token|secret/i.test(k)) {
      warnings.push(`${file} içindeki "${k}" kullanılmadı: anahtarlar dosyada tutulmaz, ortam değişkeninden okunur (tulvez --help).`);
    }
  }
  const out: CliConfigFile = {};
  if (obj.provider !== undefined) {
    if (isProvider(obj.provider)) out.provider = obj.provider;
    else warnings.push(`Bilinmeyen sağlayıcı "${String(obj.provider)}" (${file}); geçerliler: ${PROVIDERS.join(', ')}.`);
  }
  const str = (k: keyof CliConfigFile): void => {
    if (typeof obj[k] === 'string') (out as Record<string, unknown>)[k] = obj[k];
  };
  const bool = (k: keyof CliConfigFile): void => {
    if (typeof obj[k] === 'boolean') (out as Record<string, unknown>)[k] = obj[k];
  };
  str('model'); str('baseUrl'); str('ollamaUrl'); str('skillsRegistry');
  bool('allowShellCommands'); bool('gitCoAuthor'); bool('showThinking');
  if (obj.mcpServers !== undefined) out.mcpServers = obj.mcpServers;
  return out;
}

export function loadConfig(
  flags: CliFlags = {},
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): LoadedConfig {
  const warnings: string[] = [];
  const file = configPath(env, platform);
  const cfg = readConfigFile(file, warnings);

  let provider: Provider = cfg.provider ?? 'openai';
  if (env.TULVEZ_PROVIDER) {
    if (isProvider(env.TULVEZ_PROVIDER)) provider = env.TULVEZ_PROVIDER;
    else warnings.push(`TULVEZ_PROVIDER="${env.TULVEZ_PROVIDER}" tanınmadı; geçerliler: ${PROVIDERS.join(', ')}.`);
  }
  if (flags.provider !== undefined) {
    if (!isProvider(flags.provider)) {
      throw new Error(`Bilinmeyen sağlayıcı "${flags.provider}". Geçerliler: ${PROVIDERS.join(', ')}.`);
    }
    provider = flags.provider;
  }

  // Sağlayıcı değiştiyse dosyadaki model başka sağlayıcıya ait olabilir: yalnız aynı sağlayıcıda kullanılır
  const fileModel = (cfg.provider ?? 'openai') === provider ? cfg.model : undefined;
  const model = flags.model ?? env.TULVEZ_MODEL ?? fileModel ?? '';

  let apiKey = '';
  let keySource = '';
  for (const name of KEY_ENV[provider]) {
    const v = env[name]?.trim();
    if (v) { apiKey = v; keySource = name; break; }
  }
  const keysFile = keysPath(env, platform);
  if (!apiKey) {
    const saved = readSavedKeys(keysFile)[provider];
    if (saved) { apiKey = saved; keySource = KEYS_FILE; }
  }

  const settings: TulvezSettings = {
    aiProvider: provider,
    model,
    apiKey,
    ollamaUrl: env.OLLAMA_HOST ? normalizeOllama(env.OLLAMA_HOST) : cfg.ollamaUrl ?? 'http://localhost:11434',
    baseUrl: flags.baseUrl ?? env.TULVEZ_BASE_URL ?? cfg.baseUrl ?? '',
    autoApproveCommands: flags.yes ?? false,
    allowShellCommands: cfg.allowShellCommands ?? true,
    telemetry: false,
    sendCodeContext: false,
    showAiEdits: false,
    showModels: false,
    showThinking: cfg.showThinking ?? true,
    gitCoAuthor: cfg.gitCoAuthor ?? true,
  };

  return {
    settings,
    file: cfg,
    configPath: file,
    keySource,
    keysPath: keysFile,
    mcpServers: cfg.mcpServers === undefined ? [] : parseMcpServers(cfg.mcpServers, 'user'),
    warnings,
  };
}

/**
 * Ayar dosyasına yalnız verilen alanları yazar; dosyadaki diğer alanlar korunur.
 * Anahtar alanı kabul edilmez (tip düzeyinde de yok).
 */
export function saveConfigFile(file: string, patch: Pick<CliConfigFile, 'provider' | 'model' | 'baseUrl'>): void {
  let current: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch { /* yok ya da bozuk: baştan yazılır */ }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') delete current[k];
    else current[k] = v;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

/** OLLAMA_HOST "127.0.0.1:11434" biçiminde de gelebilir. */
function normalizeOllama(host: string): string {
  const h = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(h) ? h : `http://${h}`;
}

/** Anahtar eksikse kullanıcıya gösterilecek ipucu; sorun yoksa null. */
export function missingKeyHint(provider: Provider): string | null {
  if (provider === 'ollama') return null;
  const names = KEY_ENV[provider].filter((n) => n !== 'TULVEZ_API_KEY');
  const list = ['TULVEZ_API_KEY', ...names].join(' ya da ');
  return `${provider} için API anahtarı yok. tulvez yazıp kurulumda kaydet ya da ${list} ortam değişkenini ayarla.`;
}
