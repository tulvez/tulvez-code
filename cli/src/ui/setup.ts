import { execFile } from 'child_process';
import type { TulvezSettings } from '../../../src/services/messages';
import { listProviderModels } from '../../../src/services/models';
import { KEY_ENV, saveConfigFile, type Provider } from '../settings';
import { readInput } from './editor';
import { print, Spinner } from './screen';
import { select, type Choice } from './select';
import { BRAND, bold, box, c, columns, gradient } from './theme';

const PROVIDER_CHOICES: Choice<Provider>[] = [
  { value: 'openai', label: 'OpenAI', hint: 'GPT modelleri · OPENAI_API_KEY' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude modelleri · ANTHROPIC_API_KEY' },
  { value: 'gemini', label: 'Google Gemini', hint: 'Gemini modelleri · GEMINI_API_KEY' },
  { value: 'groq', label: 'Groq', hint: 'hızlı açık modeller · GROQ_API_KEY' },
  { value: 'opencode', label: 'OpenCode Zen', hint: 'tek anahtarla birçok model · OPENCODE_API_KEY' },
  { value: 'ollama', label: 'Ollama', hint: 'bilgisayarında yerel model · anahtar gerekmez' },
  { value: 'custom', label: 'Özel adres', hint: 'OpenAI uyumlu herhangi bir uç (OpenRouter, LM Studio…)' },
];

export function providerName(p: Provider): string {
  return PROVIDER_CHOICES.find((x) => x.value === p)?.label ?? p;
}

const MANUAL = '\u0000elle';

/** Sağlayıcının model listesi (8 sn içinde gelmezse boş) ve elle yazma seçeneği. */
export async function pickModel(settings: TulvezSettings): Promise<string | null> {
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
  if (!models.length) print(`  ${c.muted('Model listesi alınamadı; varsayılanı seçebilir ya da elle yazabilirsin.')}`);
  const current = models.indexOf(settings.model);
  const picked = await select<string>({
    title: 'Model',
    choices,
    initial: current >= 0 ? current + 1 : 0,
    filter: models.length > 9,
  });
  if (picked === null) return null;
  if (picked !== MANUAL) return picked;
  const typed = await readInput({ accent: () => c.brand, label: 'Model kimliği', singleLine: true, placeholder: 'ör. gpt-4o-mini' });
  return typed && 'text' in typed ? typed.text.trim() : null;
}

function setxPermanent(name: string, value: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('setx', [name, value], { windowsHide: true }, (err) => resolve(!err));
  });
}

/**
 * İlk kurulum ya da /saglayici: sağlayıcı → (adres) → anahtar → model. Sağlayıcı/model/adres
 * cli.json'a yazılır; anahtar yalnız bu oturumda kullanılır ya da (Windows) kullanıcı ortam
 * değişkenine kaydedilir. Vazgeçilirse null.
 */
export async function runSetup(current: TulvezSettings, configFile: string, first: boolean): Promise<TulvezSettings | null> {
  if (first) {
    const lines = [
      `${bold(gradient('Hadi başlayalım', BRAND))} ${c.muted('— üç adım: sağlayıcı, anahtar, model')}`,
      c.muted('Seçimlerin ayar dosyasına kaydedilir; API anahtarı dosyaya yazılmaz.'),
    ];
    for (const l of box(lines, { width: Math.min(columns() - 2, 72) })) print(` ${l}`);
    print();
  }

  const provider = await select<Provider>({
    title: 'Hangi yapay zekâ sağlayıcısını kullanacaksın?',
    choices: PROVIDER_CHOICES,
    initial: Math.max(0, PROVIDER_CHOICES.findIndex((p) => p.value === current.aiProvider)),
  });
  if (!provider) return null;
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
  }

  if (provider !== 'ollama') {
    const envName = KEY_ENV[provider].find((n) => process.env[n]?.trim());
    if (envName) {
      settings.apiKey = process.env[envName]!.trim();
      print(`${c.green('✓')} ${c.muted('API anahtarı')} ${c.text(envName)} ${c.muted('ortam değişkeninden alındı')}`);
    } else {
      const varName = KEY_ENV[provider].find((n) => n !== 'TULVEZ_API_KEY') ?? 'TULVEZ_API_KEY';
      const key = await readInput({
        accent: () => c.yellow,
        label: `${providerName(provider)} API anahtarı`,
        mask: true,
        singleLine: true,
        placeholder: 'anahtarı yapıştır ve Enter\'a bas',
      });
      if (!key || !('text' in key) || !key.text) return null;
      settings.apiKey = key.text;
      process.env[varName] = key.text;
      if (process.platform === 'win32') {
        const keep = await select<boolean>({
          title: 'Anahtar nerede dursun?',
          choices: [
            { value: true, label: 'Kalıcı kaydet', hint: `Windows kullanıcı ortam değişkeni ${varName} (setx)` },
            { value: false, label: 'Yalnız bu oturumda', hint: 'kapatınca unutulur' },
          ],
        });
        if (keep && await setxPermanent(varName, key.text)) {
          print(`${c.green('✓')} ${c.text(varName)} ${c.muted('kaydedildi; yeni açılan terminallerde de geçerli.')}`);
        } else if (keep) {
          print(`${c.red('✗')} ${c.muted('Kaydedilemedi; anahtar yalnız bu oturumda kullanılacak.')}`);
        }
      } else {
        print(`${c.green('✓')} ${c.muted('Anahtar bu oturumda kullanılacak. Kalıcı olması için kabuk profiline ekle:')}`);
        print(`    ${c.code(`export ${varName}="…"`)}  ${c.muted('(~/.bashrc, ~/.zshrc)')}`);
      }
    }
  }

  const model = await pickModel(settings);
  if (model === null) return null;
  settings.model = model;

  try {
    saveConfigFile(configFile, {
      provider: settings.aiProvider,
      model: settings.model,
      baseUrl: settings.aiProvider === 'custom' ? settings.baseUrl : undefined,
    });
  } catch (err) {
    print(`${c.red('✗')} ${c.muted(`Ayar dosyası yazılamadı: ${err instanceof Error ? err.message : String(err)}`)}`);
  }
  print(`${c.green('✓')} ${bold('Hazır!')} ${c.muted(`${providerName(settings.aiProvider)} · ${settings.model || 'varsayılan model'}`)}`);
  print();
  return settings;
}
