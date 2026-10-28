import type { AgentMode } from '../../src/services/types';

export interface CliArgs {
  /** Boşsa etkileşimli oturum açılır. */
  prompt: string;
  mode: AgentMode;
  provider?: string;
  model?: string;
  baseUrl?: string;
  cwd?: string;
  yes: boolean;
  help: boolean;
  version: boolean;
  /** `tulvez ayarlar`: etkin ayarları gösterir */
  showConfig: boolean;
}

export const MODES: readonly AgentMode[] = ['ask', 'plan', 'build'];

export function isMode(v: string): v is AgentMode {
  return (MODES as readonly string[]).includes(v);
}

const VALUE_FLAGS: Record<string, keyof CliArgs> = {
  '-m': 'mode', '--mode': 'mode',
  '--provider': 'provider',
  '--model': 'model',
  '--base-url': 'baseUrl',
  '-C': 'cwd', '--cwd': 'cwd',
};

/** Komut satırını ayrıştırır; hatalı kullanımda okunur bir Error fırlatır. */
export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { prompt: '', mode: 'build', yes: false, help: false, version: false, showConfig: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h' || a === '--help' || a === '--yardim') { out.help = true; continue; }
    if (a === '-v' || a === '--version' || a === '--surum') { out.version = true; continue; }
    if (a === '-y' || a === '--yes') { out.yes = true; continue; }
    // --model=x biçimi
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const name = eq > 0 ? a.slice(0, eq) : a;
    const key = VALUE_FLAGS[name];
    if (key) {
      const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '') throw new Error(`${name} bir değer ister.`);
      if (key === 'mode') {
        if (!isMode(value)) throw new Error(`Geçersiz mod "${value}". Geçerliler: ${MODES.join(', ')}.`);
        out.mode = value;
      } else {
        (out as unknown as Record<string, unknown>)[key] = value;
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) throw new Error(`Bilinmeyen seçenek: ${a} (tulvez --help)`);
    words.push(a);
  }
  if (words.length === 1 && (words[0] === 'ayarlar' || words[0] === 'config')) {
    out.showConfig = true;
    return out;
  }
  out.prompt = words.join(' ').trim();
  return out;
}

export const HELP = `Tulvez Code CLI — terminalde yapay zekâ kodlama yardımcısı

Kullanım:
  tulvez                      Bu klasörde etkileşimli oturum açar
                              (ilk açılışta sağlayıcı/anahtar/model kurulumu)
  tulvez "istek"              Tek istek: yanıtı yazar ve çıkar
  komut | tulvez "istek"      Girdi isteğe eklenir (ör. hata çıktısını açıklat)
  tulvez ayarlar              Etkin ayarları ve ayar dosyasının yerini gösterir

Seçenekler:
  -m, --mode <ask|plan|build> Mod (varsayılan build)
      --provider <ad>         openai, anthropic, gemini, groq, opencode, ollama, custom
      --model <kimlik>        Model kimliği
      --base-url <adres>      custom sağlayıcının OpenAI uyumlu adresi
  -C, --cwd <klasör>          Çalışma klasörü (araçlar yalnız burada okur/yazar)
  -y, --yes                   Komut ve araç onaylarını sormadan ver
  -h, --help                  Bu yardım
  -v, --version               Sürüm

API anahtarı: kurulum ekranında yapıştırıp kaydedebilirsin (anahtarlar.json,
yalnız senin okuyabildiğin dosya). Ortam değişkeni varsa önce o kullanılır:
  TULVEZ_API_KEY ya da sağlayıcınınki (OPENAI_API_KEY, ANTHROPIC_API_KEY,
  GEMINI_API_KEY, GROQ_API_KEY, OPENCODE_API_KEY). Ollama anahtar istemez.

Diğer ortam değişkenleri: TULVEZ_PROVIDER, TULVEZ_MODEL, TULVEZ_BASE_URL,
OLLAMA_HOST, TULVEZ_CONFIG_DIR, NO_COLOR.

Oturumda / yazınca komutlar listelenir; /yardim tüm kısayolları gösterir.`;
