/**
 * Ajan çekirdeğinin çalıştığı ortam. Çekirdek (agent, tools, ai, repomap, skills) `vscode`
 * modülünü doğrudan içe aktarmaz; çalışma klasörünü, ayarları ve düzenleme bildirimini buradan
 * alır. VS Code eklentisi `vscodeHost`, CLI kendi ortamını kurar.
 */
export interface Host {
  /** Ajanın kendini tanıtırken ve mod değiştirmeyi anlatırken andığı yüzey. */
  surface: 'vscode' | 'cli';
  /** Araçların dokunabildiği tek klasör; yoksa dosya araçları hata verir. */
  workspaceRoot(): string | undefined;
  /** `tulvez.<key>` ayarı; tanımlı değilse `fallback`. */
  setting<T>(key: string, fallback: T): T;
  /** Ajan bir dosyada [start, end] satırlarını (0 tabanlı) yazdı. */
  onAiEdit(filePath: string, start: number, end: number): void;
}

const noHost: Host = {
  surface: 'vscode',
  workspaceRoot: () => undefined,
  setting: (_key, fallback) => fallback,
  onAiEdit: () => {},
};

let current: Host = noHost;

export function setHost(host: Host): void {
  current = host;
}

export function host(): Host {
  return current;
}
