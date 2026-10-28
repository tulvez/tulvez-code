import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configPath, loadConfig, missingKeyHint } from './settings';

let dir: string;
const write = (obj: unknown): void => fs.writeFileSync(path.join(dir, 'cli.json'), JSON.stringify(obj), 'utf8');
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ TULVEZ_CONFIG_DIR: dir, ...extra });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tulvez-cli-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('CLI ayarları', () => {
  it('ayar dosyası yoksa varsayılanlar; komutlar açık ama onay sorulur', () => {
    const c = loadConfig({}, env());
    expect(c.settings.aiProvider).toBe('openai');
    expect(c.settings.model).toBe('');
    expect(c.settings.allowShellCommands).toBe(true);
    expect(c.settings.autoApproveCommands).toBe(false);
    expect(c.warnings).toEqual([]);
  });

  it('öncelik: dosya < ortam < komut satırı', () => {
    write({ provider: 'anthropic', model: 'dosya-model' });
    expect(loadConfig({}, env()).settings.model).toBe('dosya-model');
    expect(loadConfig({}, env({ TULVEZ_MODEL: 'ortam-model' })).settings.model).toBe('ortam-model');
    expect(loadConfig({ model: 'bayrak-model' }, env({ TULVEZ_MODEL: 'ortam-model' })).settings.model).toBe('bayrak-model');
  });

  it('sağlayıcı değişince dosyadaki model taşınmaz (başka sağlayıcının modeli olabilir)', () => {
    write({ provider: 'anthropic', model: 'claude-x' });
    expect(loadConfig({ provider: 'gemini' }, env()).settings.model).toBe('');
  });

  it('anahtar yalnız ortamdan; dosyadaki anahtar kullanılmaz ve uyarılır', () => {
    write({ provider: 'anthropic', apiKey: 'dosyadaki-gizli' });
    const c = loadConfig({}, env());
    expect(c.settings.apiKey).toBe('');
    expect(c.warnings.join(' ')).toMatch(/apiKey/);
    const k = loadConfig({}, env({ ANTHROPIC_API_KEY: 'ortam-anahtar' }));
    expect(k.settings.apiKey).toBe('ortam-anahtar');
    expect(k.keySource).toBe('ANTHROPIC_API_KEY');
    // TULVEZ_API_KEY sağlayıcınınkinden önce gelir
    expect(loadConfig({}, env({ ANTHROPIC_API_KEY: 'a', TULVEZ_API_KEY: 't' })).keySource).toBe('TULVEZ_API_KEY');
  });

  it('başka sağlayıcının anahtarı kullanılmaz', () => {
    expect(loadConfig({ provider: 'gemini' }, env({ OPENAI_API_KEY: 'o' })).settings.apiKey).toBe('');
  });

  it('bozuk dosya ve bilinmeyen sağlayıcı uyarıyla geçilir; bayraktaki bilinmeyen sağlayıcı hata', () => {
    fs.writeFileSync(path.join(dir, 'cli.json'), '{bozuk', 'utf8');
    expect(loadConfig({}, env()).warnings.join(' ')).toMatch(/JSON/);
    write({ provider: 'yok' });
    const c = loadConfig({}, env());
    expect(c.settings.aiProvider).toBe('openai');
    expect(c.warnings.join(' ')).toMatch(/Bilinmeyen sağlayıcı/);
    expect(() => loadConfig({ provider: 'yok' }, env())).toThrow(/Bilinmeyen sağlayıcı/);
  });

  it('-y onayları açar; OLLAMA_HOST adres biçimine çevrilir', () => {
    expect(loadConfig({ yes: true }, env()).settings.autoApproveCommands).toBe(true);
    expect(loadConfig({}, env({ OLLAMA_HOST: '127.0.0.1:11434' })).settings.ollamaUrl).toBe('http://127.0.0.1:11434');
  });

  it('ayar dosyası yeri platforma göre', () => {
    expect(configPath({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32')).toMatch(/tulvez[\\/]cli\.json$/);
    expect(configPath({ XDG_CONFIG_HOME: '/x' }, 'linux')).toBe(path.join('/x', 'tulvez', 'cli.json'));
  });

  it('anahtar ipucu ollama dışında değişken adlarını söyler', () => {
    expect(missingKeyHint('ollama')).toBeNull();
    expect(missingKeyHint('gemini')).toMatch(/GEMINI_API_KEY/);
  });
});
