import type { Host } from '../../src/services/host';
import type { CliConfigFile } from './settings';

/**
 * CLI ortamı: çalışma klasörü komutun çalıştığı (ya da --cwd ile verilen) klasördür.
 * Çekirdeğin okuduğu `tulvez.*` ayarları cli.json'dan gelir; editör olmadığı için
 * yazılan satırlar işaretlenmez, yalnız `onEdit` ile bildirilir.
 */
export function createCliHost(
  root: string,
  file: CliConfigFile,
  onEdit: (filePath: string) => void = () => {},
): Host {
  const settings: Record<string, unknown> = {
    gitCoAuthor: file.gitCoAuthor ?? true,
    skillsRegistry: file.skillsRegistry,
  };
  return {
    surface: 'cli',
    workspaceRoot: () => root,
    setting: <T>(key: string, fallback: T): T => (settings[key] === undefined ? fallback : (settings[key] as T)),
    onAiEdit: (filePath) => onEdit(filePath),
  };
}
