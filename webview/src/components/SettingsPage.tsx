import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import {
  AlertTriangle, Bot, Boxes, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff,
  Download, FileText, Gem, Home, Loader2, Plug, RefreshCw, Server, Sparkles, Trash2, Upload, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ModelMenu } from './ModelMenu';
import { prettyModel } from '../lib/modelName';
import { L, LOCALE } from '../lib/i18n';
import { kisaAciklama } from '../lib/slashMenu';

// Ayarlar — Codex düzeni: panelde yalnız temel ajan ayarları (bağlantı, model, izinler,
// kişiselleştirme, skills). Geri kalan her şey "Tüm ayarlar" ile VS Code'un kendi ayar
// ekranında; proje talimatları code_skills.md'de (Codex'teki "Open config.toml" karşılığı).

interface Props {
  onBack: () => void;
  onModelChange?: (model: string) => void;
  models?: string[];
}

interface Quota { model: string; retryAt?: number }
interface McpServer { name: string; source: 'user' | 'project'; state: 'connected' | 'error' | 'disabled' | 'pending'; tools: number; error?: string }
interface McpState { loading: boolean; servers: McpServer[]; pendingProject: string[] }
interface SkillStatus { exists: boolean; path: string; skills: string[] }
interface RegistryState {
  loading: boolean;
  source: string;
  skills: { id: string; name: string; description: string; tags: string[]; version?: string }[];
  installed: { id: string; name: string; source?: 'github' | 'local'; description?: string }[];
  error?: string;
  busy?: string;
}

const DEFAULT: TulvezSettings = {
  aiProvider: 'openai', model: 'gpt-4o-mini', apiKey: '',
  ollamaUrl: 'http://localhost:11434', baseUrl: 'https://opencode.ai/zen/v1',
  autoApproveCommands: false, allowShellCommands: false,
  telemetry: false, sendCodeContext: false,
  showAiEdits: true, showModels: false, showThinking: true,
  gitCoAuthor: true,
  language: 'auto',
};

const LANGUAGES: { id: TulvezSettings['language']; label: string }[] = [
  { id: 'auto', label: L('Otomatik', 'Automatic') },
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
];

interface ProviderDef { id: TulvezSettings['aiProvider']; label: string; hint: string; icon: LucideIcon; keyHint?: string }

const PROVIDERS: ProviderDef[] = [
  { id: 'openai',    label: 'OpenAI',        hint: L('GPT · o serisi', 'GPT · o series'), icon: Sparkles, keyHint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic',     hint: 'Claude Opus · Sonnet · Haiku',  icon: Bot,      keyHint: 'sk-ant-…' },
  { id: 'gemini',    label: 'Google Gemini', hint: L('Ücretsiz katman var', 'Has a free tier'), icon: Gem, keyHint: 'AIza…' },
  { id: 'groq',      label: 'Groq',          hint: L('Açık modeller, çok hızlı', 'Open models, very fast'), icon: Zap, keyHint: 'gsk_…' },
  { id: 'opencode',  label: 'OpenCode',      hint: L('Kullandıkça öde; ücretsiz modeller yalnız OpenCode’da', 'Pay as you go; free models only work in OpenCode'), icon: Boxes, keyHint: L('OpenCode Console anahtarı', 'OpenCode Console key') },
  { id: 'opencode-go', label: 'OpenCode Go', hint: L('Aylık abonelik, açık modeller', 'Monthly subscription, open models'), icon: Boxes, keyHint: L('OpenCode Go anahtarı', 'OpenCode Go key') },
  { id: 'custom',    label: L('Özel uç nokta', 'Custom endpoint'), hint: 'OpenRouter, LM Studio, vLLM…', icon: Server, keyHint: 'sk-…' },
  { id: 'ollama',    label: 'Ollama',        hint: L('Yerel, anahtarsız', 'Local, no key'), icon: Home },
];

// İzin kipleri (Codex'teki onay kipleri gibi): iki ayrı anahtarın tek karşılığı
type Permission = 'chat' | 'ask' | 'full';
const PERMISSIONS: { id: Permission; title: string; desc: string }[] = [
  { id: 'chat', title: L('Yalnız sohbet', 'Chat only'), desc: L('Dosya okur ve düzenler; terminal komutu çalıştırmaz', 'Reads and edits files; runs no terminal commands') },
  { id: 'ask',  title: L('Onaylı', 'Approved'), desc: L('Her terminal komutundan önce izin ister', 'Asks before every terminal command') },
  { id: 'full', title: L('Tam erişim', 'Full access'), desc: L('Komutları sormadan çalıştırır — yalnız güvendiğin projelerde', 'Runs commands without asking — only in projects you trust') },
];
const permissionOf = (c: TulvezSettings): Permission => (!c.allowShellCommands ? 'chat' : c.autoApproveCommands ? 'full' : 'ask');
const permissionPatch = (p: Permission): Partial<TulvezSettings> => (
  p === 'chat' ? { allowShellCommands: false, autoApproveCommands: false }
    : p === 'ask' ? { allowShellCommands: true, autoApproveCommands: false }
      : { allowShellCommands: true, autoApproveCommands: true });

// ── Yapı taşları ───────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cx-group">
      <h2 className="cx-group-title">{title}</h2>
      <div className="cx-card">{children}</div>
    </section>
  );
}

/** Özel uç nokta için örnek adresler; tıklanınca alana yazılır. */
const ENDPOINT_EXAMPLES = [
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'LM Studio', url: 'http://localhost:1234/v1' },
  { name: 'vLLM', url: 'http://localhost:8000/v1' },
];

function Row({ title, desc, control, children, onClick }: {
  title: ReactNode; desc?: ReactNode; control?: ReactNode; children?: ReactNode; onClick?: () => void;
}) {
  const main = (
    <div className="cx-row-main">
      <div className="cx-row-text">
        <span className="cx-row-title">{title}</span>
        {desc && <span className="cx-row-desc">{desc}</span>}
      </div>
      {control && <div className="cx-row-control">{control}</div>}
    </div>
  );
  return (
    <div className="cx-row">
      {onClick ? <button type="button" className="cx-row-button" onClick={onClick}>{main}</button> : main}
      {children && <div className="cx-row-extra">{children}</div>}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={`cx-switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)} />
  );
}

export function SettingsPage({ onBack, onModelChange, models: initialModels }: Props) {
  const [view, setView] = useState<'main' | 'skills'>('main');
  const [cfg, setCfg] = useState<TulvezSettings>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[] | null>(initialModels && initialModels.length ? initialModels : null);
  const [savedKey, setSavedKey] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [skills, setSkills] = useState<SkillStatus | null>(null);
  const [registry, setRegistry] = useState<RegistryState>({ loading: true, source: '', skills: [], installed: [] });
  const [mcp, setMcp] = useState<McpState>({ loading: true, servers: [], pendingProject: [] });

  const cfgRef = useRef<TulvezSettings>(DEFAULT);
  const saveTimer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);
  const pendingSaveRef = useRef<TulvezSettings | null>(null);
  const savingRef = useRef(false);
  const pendingTestRef = useRef(false);
  const switchingRef = useRef(false);

  const flushPendingSave = () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const payload = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (payload && !switchingRef.current) {
      savingRef.current = true;
      vscode.postMessage({ type: 'saveSettings', settings: payload });
    }
  };

  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1800);
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; [key: string]: unknown };
      if (data?.type === 'settingsData') {
        const settings = data.settings as TulvezSettings;
        if (switchingRef.current) {
          switchingRef.current = false;
          const merged = { ...cfgRef.current, aiProvider: settings.aiProvider, apiKey: settings.apiKey, model: settings.model };
          cfgRef.current = merged;
          setCfg(merged);
          setSavedKey(settings.apiKey);
          setLoaded(true);
          if (pendingSaveRef.current) {
            pendingSaveRef.current = merged;
            scheduleSave(merged);
          }
          return;
        }
        if (savingRef.current) {
          savingRef.current = false;
          flashSaved();
          if (!saveTimer.current) {
            cfgRef.current = settings;
            setCfg(settings);
            setSavedKey(settings.apiKey);
            setLoaded(true);
          }
          if (pendingTestRef.current) {
            pendingTestRef.current = false;
            setModelsLoading(true);
            vscode.postMessage({ type: 'listModels' });
          }
        } else if (!saveTimer.current) {
          cfgRef.current = settings;
          setCfg(settings);
          setSavedKey(settings.apiKey);
          setLoaded(true);
        }
        return;
      }
      if (data?.type === 'modelsList') {
        setModels((data.models as string[]) ?? []);
        setModelsError((data.error as string) ?? '');
        setModelsLoading(false);
        return;
      }
      if (data?.type === 'skillsStatus') {
        setSkills(data as unknown as SkillStatus);
        return;
      }
      if (data?.type === 'mcpStatus') {
        setMcp({ loading: false, servers: (data.servers as McpServer[]) ?? [], pendingProject: (data.pendingProject as string[]) ?? [] });
        return;
      }
      if (data?.type === 'skillsRegistry') {
        setRegistry({ ...(data as unknown as Omit<RegistryState, 'loading'>), loading: false, busy: undefined });
        vscode.postMessage({ type: 'getSkills' });
        return;
      }
      if (data?.type === 'quotaInfo' && data.limited) {
        setQuotas((prev) => [
          ...prev.filter((q) => q.model !== data.model),
          { model: data.model as string, retryAt: data.retryAt as number | undefined },
        ]);
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'getSettings' });
    vscode.postMessage({ type: 'getSkills' });
    vscode.postMessage({ type: 'getSkillsRegistry' });
    vscode.postMessage({ type: 'getMcpStatus' });

    return () => {
      window.removeEventListener('message', handler);
      flushPendingSave();
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (cfg.aiProvider !== 'ollama' && cfg.aiProvider !== 'custom' && !savedKey) {
      setModels(null);
      setModelsError('');
      return;
    }
    const timer = window.setTimeout(() => {
      setModelsLoading(true);
      vscode.postMessage({ type: 'listModels' });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [loaded, cfg.aiProvider, savedKey]);

  const scheduleSave = (next: TulvezSettings) => {
    pendingSaveRef.current = next;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const payload = pendingSaveRef.current;
      if (!payload) return;
      pendingSaveRef.current = null;
      savingRef.current = true;
      vscode.postMessage({ type: 'saveSettings', settings: payload });
    }, 500);
  };

  const apply = (partial: Partial<TulvezSettings>) => {
    const next = { ...cfgRef.current, ...partial };
    cfgRef.current = next;
    setCfg(next);
    scheduleSave(next);
  };

  const persistNow = (next: TulvezSettings) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingSaveRef.current = null;
    cfgRef.current = next;
    setCfg(next);
    savingRef.current = true;
    vscode.postMessage({ type: 'saveSettings', settings: next });
  };

  const pickProvider = (provider: TulvezSettings['aiProvider']) => {
    if (provider === cfgRef.current.aiProvider) return;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const next = { ...cfgRef.current, aiProvider: provider, model: '', apiKey: '' };
    cfgRef.current = next;
    setCfg(next);
    setModels(null);
    setModelsError('');
    setModelsLoading(false);
    setKeyOpen(provider !== 'ollama');
    switchingRef.current = true;
    vscode.postMessage({ type: 'switchProvider', provider });
  };

  const clearKey = () => {
    persistNow({ ...cfgRef.current, apiKey: '' });
    setSavedKey('');
    setModels(null);
    setModelsError('');
    setShowKey(false);
  };

  const testConnection = () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      savingRef.current = true;
      pendingTestRef.current = true;
      pendingSaveRef.current = null;
      setModelsLoading(true);
      vscode.postMessage({ type: 'saveSettings', settings: cfgRef.current });
      return;
    }
    setModelsLoading(true);
    setModelsError('');
    setModels(null);
    vscode.postMessage({ type: 'listModels' });
  };

  const pickModel = (model: string) => {
    apply({ model });
    onModelChange?.(model);
  };

  const skillAction = (type: 'installSkill' | 'removeSkill', id: string) => {
    setRegistry((r) => ({ ...r, busy: id, error: undefined }));
    vscode.postMessage({ type, id });
  };

  // Dosya seçme penceresi eklenti tarafında açılır; sonuçta güncel liste gelir
  const importSkill = () => {
    setRegistry((r) => ({ ...r, busy: '__import', error: undefined }));
    vscode.postMessage({ type: 'importSkill' });
  };
  const exportSkill = (id: string) => vscode.postMessage({ type: 'exportSkill', id });

  const reloadRegistry = () => {
    setRegistry((r) => ({ ...r, loading: true, error: undefined }));
    vscode.postMessage({ type: 'getSkillsRegistry' });
  };

  const handleBack = () => {
    if (view !== 'main') { setView('main'); return; }
    flushPendingSave();
    onBack();
  };

  const provider = PROVIDERS.find((p) => p.id === cfg.aiProvider) ?? PROVIDERS[0];
  const connected = cfg.aiProvider === 'custom' ? !!cfg.baseUrl : cfg.aiProvider === 'ollama' || !!cfg.apiKey;
  const permission = permissionOf(cfg);
  const installedIds = new Set(registry.installed.map((s) => s.id));
  const connectionText = modelsLoading ? L('Sınanıyor…', 'Testing…')
    : modelsError ? L('Bağlantı kurulamadı', 'Could not connect')
      : models !== null ? `${L('Bağlı', 'Connected')} · ${models.length} ${L('model', 'models')}`
        : connected ? L('Henüz sınanmadı', 'Not tested yet') : L('Anahtar bekleniyor', 'Waiting for a key');

  // ── Skills alt sayfası ────────────────────────────────────────────
  const renderSkills = () => (
    <>
      <p className="cx-intro">
        {L("Skills, Tulvez Code'a belirli bir işi nasıl yapacağını öğreten talimatlardır. Tulvez'in GitHub'daki becerileri kendiliğinden kurulur ve güncellenir; isteğin bir beceriye uyarsa Tulvez Code onu kendisi kullanır. İstersen ",
          "Skills are instructions that teach Tulvez Code how to do a specific job. Tulvez's skills on GitHub install and update themselves; if your request matches a skill, Tulvez Code uses it on its own. You can also run one with ")}
        <code>/skill &lt;{L('ad', 'name')}&gt;</code>{L(' ile de çalıştırabilirsin.', '.')}
      </p>
      <Section title={L('Tulvez becerileri', 'Tulvez skills')}>
        <Row title={registry.loading ? L('Yükleniyor…', 'Loading…') : registry.error ? L('Depoya ulaşılamadı', 'Could not reach the repository') : `${registry.source.startsWith('https://github.com/') ? L('GitHub’da ', 'On GitHub: ') : ''}${registry.skills.length} ${L('beceri', registry.skills.length === 1 ? 'skill' : 'skills')}`}
          desc={registry.error ?? (registry.installed.length ? `${registry.installed.length} ${L('kurulu', 'installed')}` : L('Henüz kurulu skill yok', 'No skills installed yet'))}
          control={(
            <button className="cx-btn" type="button" onClick={reloadRegistry} disabled={registry.loading} title={L('Yenile', 'Refresh')}>
              <RefreshCw size={12} className={registry.loading ? 'spin' : ''} />
            </button>
          )} />
        {registry.skills.map((s) => {
          const isIn = installedIds.has(s.id);
          const busy = registry.busy === s.id;
          return (
            <Row key={s.id}
              title={<>{s.name}{s.version && <span className="cx-ver">{s.version}</span>}</>}
              desc={<span className="cx-desc-fixed" title={s.description}>{kisaAciklama(s.description)}</span>}
              control={(
                <>
                  {isIn && (
                    <button className="cx-btn" type="button" title={L('Bilgisayara indir', 'Download to your computer')} aria-label={L('Bilgisayara indir', 'Download to your computer')} onClick={() => exportSkill(s.id)}>
                      <Download size={12} />
                    </button>
                  )}
                  <button className={`cx-btn ${isIn ? '' : 'cx-btn-primary'}`} type="button" disabled={busy}
                    onClick={() => skillAction(isIn ? 'removeSkill' : 'installSkill', s.id)}>
                    {busy ? <Loader2 size={12} className="spin" /> : isIn ? L('Kaldır', 'Remove') : L('Kur', 'Install')}
                  </button>
                </>
              )} />
          );
        })}
        {registry.installed.filter((s) => !registry.skills.some((r) => r.id === s.id)).map((s) => (
          <Row key={s.id} title={s.name}
            desc={s.source === 'local'
              ? <span className="cx-desc-fixed" title={s.description}>{kisaAciklama(`${s.description ? `${s.description} · ` : ''}${L('Bilgisayardan yüklendi', 'Uploaded from your computer')}`)}</span>
              : `.tulvez/skills/${s.id}.md`}
            control={(
              <>
                {s.source && (
                  <button className="cx-btn" type="button" title={L('Bilgisayara indir', 'Download to your computer')} aria-label={L('Bilgisayara indir', 'Download to your computer')} onClick={() => exportSkill(s.id)}>
                    <Download size={12} />
                  </button>
                )}
                <button className="cx-btn" type="button" onClick={() => skillAction('removeSkill', s.id)}>{L('Kaldır', 'Remove')}</button>
              </>
            )} />
        ))}
        <Row title={L('Bilgisayardan yükle', 'Upload from your computer')} desc={L('Herhangi bir adla .md dosyaları ya da klasörler; birden çok seçebilirsin', '.md files with any name, or folders; you can pick several')}
          control={(
            <button className="cx-btn" type="button" onClick={importSkill} disabled={registry.busy === '__import'}>
              {registry.busy === '__import' ? <Loader2 size={12} className="spin" /> : <Upload size={12} />} {L('Yükle', 'Upload')}
            </button>
          )} />
      </Section>
      <Section title={L('Bu proje', 'This project')}>
        <Row title="code_skills.md" desc={skills?.exists ? L("Projeye özel kimlik, kurallar ve skill'ler", 'Project-specific identity, rules and skills') : L('Henüz yok — oluşturunca düzenlemek için açılır', 'Not created yet — it opens for editing when created')}
          control={(
            <button className="cx-btn" type="button" onClick={() => vscode.postMessage({ type: 'openSkillsFile' })}>
              {skills?.exists ? L('Aç', 'Open') : L('Oluştur', 'Create')}
            </button>
          )} />
      </Section>
    </>
  );

  // ── Ana sayfa ─────────────────────────────────────────────────────
  const renderMain = () => (
    <>
      <Section title={L('Bağlantı', 'Connection')}>
        <Row title={L('Sağlayıcı', 'Provider')} desc={provider.hint}
          control={(
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button className="cx-select" type="button">
                  <provider.icon size={13} />
                  <span>{provider.label}</span>
                  <ChevronDown size={12} className="cx-chev" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" className="tz-menu cx-menu"
                onCloseAutoFocus={(e) => e.preventDefault()}>
                {PROVIDERS.map((p) => (
                  <DropdownMenuItem key={p.id} className={`tz-menu-item cx-menu-item ${p.id === cfg.aiProvider ? 'is-on' : ''}`}
                    onSelect={() => pickProvider(p.id)}>
                    <p.icon size={14} />
                    <span className="cx-menu-text">
                      <span className="cx-menu-name">{p.label}</span>
                      <span className="cx-menu-hint">{p.hint}</span>
                    </span>
                    {p.id === cfg.aiProvider && <Check size={12} className="tz-menu-check" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )} />

        {cfg.aiProvider === 'custom' && (
          <Row title={L('Adres', 'Address')} desc={L('OpenAI uyumlu uç noktanın /v1 adresi', 'The /v1 address of the OpenAI-compatible endpoint')}>
            <input className="cx-input" type="text" spellCheck={false} aria-label="Base URL"
              value={cfg.baseUrl || ''} placeholder="https://openrouter.ai/api/v1"
              onChange={(e) => apply({ baseUrl: e.target.value })} />
            <div className="cx-examples">
              <span className="cx-examples-label">{L('Örnek', 'Example')}</span>
              {ENDPOINT_EXAMPLES.map((x) => (
                <button key={x.url} type="button" className="cx-example" title={`${x.name} — ${L('kullanmak için tıkla', 'click to use')}`}
                  onClick={() => apply({ baseUrl: x.url })}>
                  <span className="cx-example-url">{x.url}</span>
                  <span className="cx-example-name">{x.name}</span>
                </button>
              ))}
            </div>
          </Row>
        )}
        {cfg.aiProvider === 'ollama' && (
          <Row title={L('Ollama sunucusu', 'Ollama server')} desc={L('Anahtar gerekmez', 'No key needed')}>
            <input className="cx-input" type="text" spellCheck={false} aria-label={L('Ollama sunucusu', 'Ollama server')}
              value={cfg.ollamaUrl || ''} placeholder="http://localhost:11434"
              onChange={(e) => apply({ ollamaUrl: e.target.value })} />
          </Row>
        )}
        {cfg.aiProvider !== 'ollama' && (
          <Row title={L('API anahtarı', 'API key')}
            desc={cfg.apiKey ? L('Kayıtlı · VS Code SecretStorage', 'Saved · VS Code SecretStorage') : cfg.aiProvider === 'custom' ? L('İsteğe bağlı', 'Optional') : L('Gerekli', 'Required')}
            control={(
              <button className="cx-btn" type="button" onClick={() => setKeyOpen((o) => !o)}>
                {keyOpen ? L('Kapat', 'Close') : cfg.apiKey ? L('Değiştir', 'Change') : L('Ekle', 'Add')}
              </button>
            )}>
            {(keyOpen || (!savedKey && cfg.aiProvider !== 'custom')) && (
              <div className="cx-input-group">
                <input className="cx-input cx-mono" type={showKey ? 'text' : 'password'} aria-label={L('API anahtarı', 'API key')}
                  value={cfg.apiKey || ''} placeholder={provider.keyHint ?? L('Anahtar', 'Key')} autoComplete="off" spellCheck={false}
                  onChange={(e) => { setKeyOpen(true); apply({ apiKey: e.target.value }); }} />
                <button className="tz-ghost-icon" type="button" title={showKey ? L('Gizle', 'Hide') : L('Göster', 'Show')} onClick={() => setShowKey((x) => !x)}>
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                {cfg.apiKey && (
                  <button className="tz-ghost-icon" type="button" title={L('Anahtarı sil', 'Delete key')} onClick={clearKey}><Trash2 size={13} /></button>
                )}
              </div>
            )}
          </Row>
        )}
        <Row title={L('Durum', 'Status')}
          desc={<span className="cx-status"><span className={`cx-dot ${modelsError ? 'is-err' : models !== null ? 'is-ok' : ''}`} />{connectionText}</span>}
          control={(
            <button className="cx-btn" type="button" onClick={testConnection} disabled={modelsLoading}>
              <RefreshCw size={12} className={modelsLoading ? 'spin' : ''} /> {L('Sına', 'Test')}
            </button>
          )}>
          {modelsError && <div className="cx-alert"><AlertTriangle size={13} /><span>{modelsError}</span></div>}
          {quotas.map((qt) => (
            <div className="cx-note" key={qt.model}>
              <b title={qt.model}>{prettyModel(qt.model)}</b> {L('kotası doldu', 'quota used up')}
              {qt.retryAt ? ` · ${L('', 'after ')}${new Date(qt.retryAt).toLocaleString(LOCALE)}${L(' sonra', '')}` : ''}
            </div>
          ))}
        </Row>
      </Section>

      <Section title="Model">
        <Row title={L('Varsayılan model', 'Default model')} desc={connected ? L('Sohbette model seçilmediğinde kullanılır', 'Used when no model is picked in the chat') : L('Önce sağlayıcıya bağlan', 'Connect to a provider first')}
          control={connected ? (
            <ModelMenu value={cfg.model} models={models ?? []} allowDefault={false} side="bottom" align="end" onSelect={pickModel}
              emptyText={modelsLoading ? L('Modeller yükleniyor…', 'Loading models…') : L('Model listesi boş — bağlantıyı sına', 'The model list is empty — test the connection')}
              trigger={(
                <button className="cx-select" type="button" title={cfg.model}>
                  <span className="cx-select-label">{cfg.model ? prettyModel(cfg.model) : L('Seç', 'Choose')}</span>
                  <ChevronDown size={12} className="cx-chev" />
                </button>
              )} />
          ) : undefined} />
      </Section>

      <Section title={L('İzinler', 'Permissions')}>
        <div className="cx-radios" role="radiogroup" aria-label={L('İzinler', 'Permissions')}>
          {PERMISSIONS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={permission === p.id}
              className={`cx-radio ${permission === p.id ? 'is-on' : ''} ${p.id === 'full' ? 'is-danger' : ''}`}
              onClick={() => apply(permissionPatch(p.id))}>
              <span className="cx-radio-dot" />
              <span className="cx-row-text">
                <span className="cx-row-title">{p.title}</span>
                <span className="cx-row-desc">{p.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={L('Kişiselleştirme', 'Personalization')}>
        <Row title="Dil · Language" desc={L('Arayüz ve yanıtların dili; Otomatik VS Code’un dilini izler. Değişince panel yeniden yüklenir.', 'Language of the interface and replies; Automatic follows the VS Code language. The panel reloads when it changes.')}
          control={(
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button className="cx-select" type="button">
                  <span>{LANGUAGES.find((x) => x.id === (cfg.language ?? 'auto'))?.label}</span>
                  <ChevronDown size={12} className="cx-chev" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" className="tz-menu cx-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
                {LANGUAGES.map((x) => (
                  <DropdownMenuItem key={x.id} className={`tz-menu-item cx-menu-item ${x.id === (cfg.language ?? 'auto') ? 'is-on' : ''}`}
                    onSelect={() => persistNow({ ...cfgRef.current, language: x.id })}>
                    <span className="cx-menu-text"><span className="cx-menu-name">{x.label}</span></span>
                    {x.id === (cfg.language ?? 'auto') && <Check size={12} className="tz-menu-check" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )} />
        <Row title={L('Düşünüşü göster', 'Show reasoning')} desc={L('Modelin akıl yürütmesi yanıtın üstünde', "The model's reasoning above the reply")}
          control={<Switch label={L('Düşünüşü göster', 'Show reasoning')} checked={cfg.showThinking} onChange={(x) => apply({ showThinking: x })} />} />
        <Row title={L('Düzenlemeleri işaretle', 'Highlight edits')} desc={L("Tulvez'in yazdığı satırlar editörde vurgulanır", 'Lines written by Tulvez are highlighted in the editor')}
          control={<Switch label={L('Düzenlemeleri işaretle', 'Highlight edits')} checked={cfg.showAiEdits} onChange={(x) => apply({ showAiEdits: x })} />} />
        <Row title={L('Seçili kodu gönder', 'Send selected code')} desc={L('Editörde seçili kod mesajla birlikte gider', 'The code selected in the editor goes with your message')}
          control={<Switch label={L('Seçili kodu gönder', 'Send selected code')} checked={cfg.sendCodeContext} onChange={(x) => apply({ sendCodeContext: x })} />} />
        <Row title={L("GitHub'da ek katkıcı", 'Co-author on GitHub')} desc={L("Commit'lerde yanında tulvez-code[bot] görünür", 'tulvez-code[bot] appears next to you in commits')}
          control={<Switch label={L("GitHub'da ek katkıcı", 'Co-author on GitHub')} checked={cfg.gitCoAuthor} onChange={(x) => apply({ gitCoAuthor: x })} />} />
      </Section>

      <Section title={L('MCP sunucuları', 'MCP servers')}>
        {mcp.servers.length === 0 && !mcp.loading && (
          <Row title={L('Bağlı sunucu yok', 'No servers connected')}
            desc={L("MCP ile Tulvez Code'a dış araçlar eklersin (veritabanı, GitHub, tarayıcı…). Araçlar Build modunda, onayla çalışır.", 'With MCP you add external tools to Tulvez Code (databases, GitHub, browsers…). Tools run in Build mode, with your approval.')} />
        )}
        {mcp.loading && <Row title={L('Bağlanıyor…', 'Connecting…')} control={<Loader2 size={13} className="spin" />} />}
        {mcp.servers.map((srv) => (
          <Row key={srv.name}
            title={<><Plug size={12} style={{ marginRight: 6, verticalAlign: '-1px' }} />{srv.name}{srv.source === 'project' && <span className="cx-ver">{L('proje', 'project')}</span>}</>}
            desc={srv.state === 'connected' ? `${L('Bağlı', 'Connected')} · ${srv.tools} ${L('araç', 'tools')}`
              : srv.state === 'disabled' ? L('Kapalı (disabled)', 'Off (disabled)')
                : srv.state === 'pending' ? L('Bağlanıyor…', 'Connecting…')
                  : `${L('Bağlanamadı', 'Could not connect')}: ${srv.error ?? L('bilinmeyen hata', 'unknown error')}`} />
        ))}
        {mcp.pendingProject.length > 0 && (
          <Row title={L(`Projede ${mcp.pendingProject.length} sunucu izin bekliyor`, `${mcp.pendingProject.length} project server(s) waiting for permission`)} desc={`.mcp.json: ${mcp.pendingProject.join(', ')}`}
            control={<button className="cx-btn" type="button" onClick={() => { setMcp((m) => ({ ...m, loading: true })); vscode.postMessage({ type: 'reconnectMcp' }); }}>{L('İzin ver…', 'Allow…')}</button>} />
        )}
        <Row title={L('Sunucuları düzenle', 'Edit servers')} desc={L('settings.json → tulvez.mcpServers (Claude Code / Cursor biçimi)', 'settings.json → tulvez.mcpServers (Claude Code / Cursor format)')}
          control={(
            <>
              <button className="cx-btn" type="button" title={L('Yeniden bağlan', 'Reconnect')} aria-label={L('Yeniden bağlan', 'Reconnect')} disabled={mcp.loading}
                onClick={() => { setMcp((m) => ({ ...m, loading: true })); vscode.postMessage({ type: 'reconnectMcp' }); }}>
                <RefreshCw size={12} className={mcp.loading ? 'spin' : ''} />
              </button>
              <button className="cx-btn" type="button" onClick={() => vscode.postMessage({ type: 'openMcpSettings' })}>{L('Düzenle', 'Edit')}</button>
            </>
          )} />
      </Section>

      <Section title="Skills">
        <Row title={L("Skill'leri yönet", 'Manage skills')}
          desc={registry.installed.length ? `${registry.installed.length} ${L('kurulu · Tulvez Code gerektiğinde kendisi kullanır', 'installed · Tulvez Code uses them when needed')}` : L('Tulvez becerilerini gör', 'See Tulvez skills')}
          control={<ChevronRight size={15} className="cx-chev" />}
          onClick={() => setView('skills')} />
      </Section>

      <div className="cx-links">
        <button type="button" className="cx-link" onClick={() => vscode.postMessage({ type: 'openSkillsFile' })}>
          <FileText size={13} /> {L("code_skills.md'yi aç", 'Open code_skills.md')}
        </button>
        <button type="button" className="cx-link" onClick={() => vscode.postMessage({ type: 'openVsSettings' })}>
          <ExternalLink size={13} /> {L('Tüm ayarlar (VS Code)', 'All settings (VS Code)')}
        </button>
      </div>
    </>
  );

  return (
    <div className="cx-page">
      <header className="cx-top">
        <button className="tz-icon-btn" type="button" onClick={handleBack} title={view === 'main' ? L('Sohbete dön', 'Back to chat') : L('Ayarlara dön', 'Back to settings')}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span className="cx-top-title">{view === 'main' ? L('Ayarlar', 'Settings') : 'Skills'}</span>
        <span className={`cx-saved ${saved ? 'is-on' : ''}`} aria-live="polite"><Check size={12} /> {L('Kaydedildi', 'Saved')}</span>
      </header>

      <div className="cx-body">
        {!loaded ? (
          <div className="cx-loading"><Loader2 size={15} className="spin" /><span>{L('Yükleniyor…', 'Loading…')}</span></div>
        ) : view === 'main' ? renderMain() : renderSkills()}
      </div>
    </div>
  );
}
