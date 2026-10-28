import type { TulvezSettings } from '../../../src/services/messages';
import { listProviderModels } from '../../../src/services/models';
import { KEY_ENV, KEYS_FILE, readSavedKeys, saveConfigFile, saveKey, type Provider } from '../settings';
import { readInput } from './editor';
import { print, screen, Spinner } from './screen';
import { select, type Choice } from './select';
import { BRAND, bold, c, gradient } from './theme';

const PROVIDER_CHOICES: Choice<Provider>[] = [
  { value: 'openai', label: 'OpenAI', hint: 'GPT modelleri' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude modelleri' },
  { value: 'gemini', label: 'Google Gemini', hint: 'Gemini modelleri' },
  { value: 'groq', label: 'Groq', hint: 'hızlı açık modeller' },
  { value: 'opencode', label: 'OpenCode Zen', hint: 'tek anahtarla birçok model' },
  { value: 'ollama', label: 'Ollama', hint: 'bilgisayarında yerel model · anahtar gerekmez' },
  { value: 'custom', label: 'Özel adres', hint: 'OpenAI uyumlu herhangi bir uç (OpenRouter, LM Studio…)' },
];

export function providerName(p: Provider): string {
  return PROVIDER_CHOICES.find((x) => x.value === p)?.label ?? p;
}

const MANUAL = '\u0000elle';

/**
 * Kurulum adımları logonun altında birikir; kurulum bitince silinir (sohbete satır bırakmaz).
 * Kurulum dışında (/model) satırlar sohbete yazılır.
 */
class Progress {
  private lines: string[] = [];
  constructor(readonly inSetup: boolean) {}
  add(line: string): void {
    if (!this.inSetup) { print(line); return; }
    this.lines.push(`  ${line}`);
    screen.setSlot('setup', ['', ...this.lines, '']);
  }
  clear(): void {
    if (this.inSetup) screen.setSlot('setup', null);
  }
}

/** Sağlayıcının model listesi (8 sn içinde gelmezse boş) ve elle yazma seçeneği. */
export async function pickModel(settings: TulvezSettings, progress = new Progress(false)): Promise<string | null> {
  const spinner = new Spinner();
  spinner.start('Modeller alınıyor');
  let models: string[] = [];
  try {
    models = await Promise.race([
      listProviderModels(settings),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('zaman aşımı')), 8000)),
    ]);
  } catch {
    models = [];
  } finally {
    spinner.stop();
  }
  const choices: Choice<string>[] = [
    { value: '', label: 'Sağlayıcının varsayılanı', hint: 'Tulvez Code seçer' },
    ...models.map((m) => ({ value: m, label: m, hint: m === settings.model ? 'şu an' : undefined })),
    { value: MANUAL, label: 'Elle yaz…', hint: 'listede olmayan bir model kimliği' },
  ];
  if (!models.length) progress.add(c.muted('Model listesi alınamadı; varsayılanı seçebilir ya da elle yazabilirsin.'));
  const current = models.indexOf(settings.model);
  const picked = await select<string>({
    title: 'Model',
    choices,
    initial: current >= 0 ? current + 1 : 0,
    filter: models.length > 9,
    // Kurulumda özet ilerleme listesine yazılır; sohbete satır düşmesin
    summary: !progress.inSetup,
  });
  if (picked === null) return null;
  if (picked !== MANUAL) return picked;
  const typed = await readInput({ accent: () => c.brand, label: 'Model kimliği', singleLine: true, placeholder: 'ör. gpt-4o-mini' });
  return typed && 'text' in typed ? typed.text.trim() : null;
}

/**
 * Anahtar adımı: ortam değişkeni varsa o; kayıtlı anahtar varsa "kullan / yeni gir"; yoksa yapıştırılır
 * ve istenirse kaydedilir. Vazgeçilirse null.
 */
async function askKey(provider: Provider, keysFile: string, progress: Progress): Promise<string | null> {
  const envName = KEY_ENV[provider].find((n) => process.env[n]?.trim());
  if (envName) {
    progress.add(`${c.green('✓')} ${c.muted('API anahtarı')} ${c.text(envName)} ${c.muted('ortam değişkeninden')}`);
    return process.env[envName]!.trim();
  }
  const saved = readSavedKeys(keysFile)[provider];
  if (saved) {
    const reuse = await select<boolean>({
      title: `${providerName(provider)} için kayıtlı bir anahtar var`,
      choices: [{ value: true, label: 'Kayıtlı anahtarı kullan' }, { value: false, label: 'Yeni anahtar gir' }],
      summary: false,
    });
    if (reuse === null) return null;
    if (reuse) {
      progress.add(`${c.green('✓')} ${c.muted('API anahtarı')} ${c.text('kayıtlı')} ${c.muted(`(${KEYS_FILE})`)}`);
      return saved;
    }
  }
  const typed = await readInput({
    accent: () => c.yellow,
    label: `${providerName(provider)} API anahtarı`,
    mask: true,
    singleLine: true,
    placeholder: 'yapıştır (Ctrl+V ya da sağ tık) ve Enter\'a bas',
  });
  if (!typed || !('text' in typed) || !typed.text) return null;
  const key = typed.text;
  const keep = await select<boolean>({
    title: 'Anahtar kaydedilsin mi?',
    choices: [
      { value: true, label: 'Kaydet', hint: `bu bilgisayarda, yalnız senin okuyabildiğin dosyada (${KEYS_FILE})` },
      { value: false, label: 'Yalnız bu oturumda', hint: 'kapatınca unutulur' },
    ],
    summary: false,
  });
  if (keep === null) return null;
  if (keep) {
    try {
      saveKey(keysFile, provider, key);
      progress.add(`${c.green('✓')} ${c.muted('API anahtarı kaydedildi')} ${c.text(keysFile)}`);
    } catch (err) {
      progress.add(`${c.red('✗')} ${c.muted(`Kaydedilemedi (${err instanceof Error ? err.message : String(err)}); bu oturumda kullanılacak`)}`);
    }
  } else {
    progress.add(`${c.green('✓')} ${c.muted('API anahtarı bu oturumda kullanılacak')}`);
  }
  return key;
}

/**
 * Sağlayıcı ve model kayıtlı ama anahtar yok (önceki sürüm anahtarı kaydetmiyordu ya da "yalnız bu
 * oturumda" seçilmişti): kurulum baştan sorulmaz, yalnız anahtar istenir. Vazgeçilirse null.
 */
export async function askMissingKey(current: TulvezSettings, keysFile: string): Promise<TulvezSettings | null> {
  const progress = new Progress(true);
  try {
    progress.add(`${c.muted('Kurulumun hatırlandı:')} ${c.text(providerName(current.aiProvider))}${c.muted(' · ')}${c.text(current.model || 'varsayılan model')}${c.muted(' — yalnız API anahtarı gerekiyor')}`);
    const key = await askKey(current.aiProvider, keysFile, progress);
    return key === null ? null : { ...current, apiKey: key };
  } finally {
    progress.clear();
  }
}

/**
 * İlk kurulum ya da /provider: sağlayıcı → (adres) → anahtar → model. Sağlayıcı/model/adres
 * cli.json'a, anahtar istenirse anahtarlar.json'a (600) yazılır. Vazgeçilirse null.
 */
export async function runSetup(
  current: TulvezSettings,
  files: { config: string; keys: string },
  inSetup: boolean,
): Promise<TulvezSettings | null> {
  const progress = new Progress(inSetup);
  try {
    if (inSetup) progress.add(`${bold(gradient('Hadi başlayalım', BRAND))} ${c.muted('— sağlayıcı, anahtar, model')}`);

    const provider = await select<Provider>({
      title: 'Hangi yapay zekâ sağlayıcısını kullanacaksın?',
      choices: PROVIDER_CHOICES,
      initial: Math.max(0, PROVIDER_CHOICES.findIndex((p) => p.value === current.aiProvider)),
      summary: !inSetup,
    });
    if (!provider) return null;
    if (inSetup) progress.add(`${c.green('✓')} ${c.muted('Sağlayıcı')} ${c.text(providerName(provider))}`);
    const settings: TulvezSettings = { ...current, aiProvider: provider, model: provider === current.aiProvider ? current.model : '' };

    if (provider === 'custom') {
      const url = await readInput({
        accent: () => c.brand,
        label: 'OpenAI uyumlu adres',
        singleLine: true,
        placeholder: settings.baseUrl || 'https://openrouter.ai/api/v1',
      });
      if (!url || !('text' in url)) return null;
      settings.baseUrl = url.text.trim() || settings.baseUrl;
      if (!settings.baseUrl) return null;
      progress.add(`${c.green('✓')} ${c.muted('Adres')} ${c.text(settings.baseUrl)}`);
    }

    if (provider !== 'ollama') {
      const key = await askKey(provider, files.keys, progress);
      if (key === null) return null;
      settings.apiKey = key;
    }

    const model = await pickModel(settings, progress);
    if (model === null) return null;
    settings.model = model;
    if (inSetup) progress.add(`${c.green('✓')} ${c.muted('Model')} ${c.text(model || 'sağlayıcının varsayılanı')}`);

    try {
      saveConfigFile(files.config, {
        provider: settings.aiProvider,
        model: settings.model,
        baseUrl: settings.aiProvider === 'custom' ? settings.baseUrl : undefined,
      });
    } catch (err) {
      progress.add(`${c.red('✗')} ${c.muted(`Ayar dosyası yazılamadı: ${err instanceof Error ? err.message : String(err)}`)}`);
    }
    if (!inSetup) print(`${c.green('✓')} ${bold('Hazır')} ${c.muted(`${providerName(settings.aiProvider)} · ${settings.model || 'varsayılan model'}`)}`);
    return settings;
  } finally {
    progress.clear();
  }
}
