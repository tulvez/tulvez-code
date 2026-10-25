import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import {
  AlertTriangle, Bot, Boxes, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff,
  FileText, Gem, Home, Loader2, RefreshCw, Server, Sparkles, Trash2, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ModelMenu } from './ModelMenu';
import { prettyModel } from '../lib/modelName';

// Ayarlar — Codex düzeni: panelde yalnız temel ajan ayarları (bağlantı, model, izinler,
// kişiselleştirme, skills). Geri kalan her şey "Tüm ayarlar" ile VS Code'un kendi ayar
// ekranında; proje talimatları code_skills.md'de (Codex'teki "Open config.toml" karşılığı).

interface Props {
  onBack: () => void;
  onModelChange?: (model: string) => void;
  models?: string[];
}

interface Quota { model: string; retryAt?: number }
interface SkillStatus { exists: boolean; path: string; skills: string[] }
interface RegistryState {
  loading: boolean;
  source: string;
  skills: { id: string; name: string; description: string; tags: string[]; version?: string }[];
  installed: { id: string; name: string }[];
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
  gitBotAuthor: false,
};

interface ProviderDef { id: TulvezSettings['aiProvider']; label: string; hint: string; icon: LucideIcon; keyHint?: string }

const PROVIDERS: ProviderDef[] = [
  { id: 'openai',    label: 'OpenAI',        hint: 'GPT · o serisi',                icon: Sparkles, keyHint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic',     hint: 'Claude Opus · Sonnet · Haiku',  icon: Bot,      keyHint: 'sk-ant-…' },
  { id: 'gemini',    label: 'Google Gemini', hint: 'Ücretsiz katman var',           icon: Gem,      keyHint: 'AIza…' },
  { id: 'groq',      label: 'Groq',          hint: 'Açık modeller, çok hızlı',      icon: Zap,      keyHint: 'gsk_…' },
  { id: 'opencode',  label: 'OpenCode Zen',  hint: 'Tek anahtarla birçok model',    icon: Boxes,    keyHint: 'zen-…' },
  { id: 'custom',    label: 'Özel uç nokta', hint: 'OpenRouter, LM Studio, vLLM…',  icon: Server,   keyHint: 'sk-…' },
  { id: 'ollama',    label: 'Ollama',        hint: 'Yerel, anahtarsız',             icon: Home },
];

// İzin kipleri (Codex'teki onay kipleri gibi): iki ayrı anahtarın tek karşılığı
type Permission = 'chat' | 'ask' | 'full';
const PERMISSIONS: { id: Permission; title: string; desc: string }[] = [
  { id: 'chat', title: 'Yalnız sohbet', desc: 'Dosya okur ve düzenler; terminal komutu çalıştırmaz' },
  { id: 'ask',  title: 'Onaylı',        desc: 'Her terminal komutundan önce izin ister' },
  { id: 'full', title: 'Tam erişim',    desc: 'Komutları sormadan çalıştırır — yalnız güvendiğin projelerde' },
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
  const connectionText = modelsLoading ? 'Sınanıyor…'
    : modelsError ? 'Bağlantı kurulamadı'
      : models !== null ? `Bağlı · ${models.length} model`
        : connected ? 'Henüz sınanmadı' : 'Anahtar bekleniyor';

  // ── Skills alt sayfası ────────────────────────────────────────────
  const renderSkills = () => (
    <>
      <p className="cx-intro">
        Skills, Tulvez Code'a belirli bir işi nasıl yapacağını öğreten talimatlardır. Kurulan skill
        <code>/skill &lt;ad&gt;</code> ile çalışır.
      </p>
      <Section title="Tulvez skills deposu">
        <Row title={registry.loading ? 'Yükleniyor…' : registry.error ? 'Depoya ulaşılamadı' : `${registry.skills.length} skill`}
          desc={registry.error ?? (registry.installed.length ? `${registry.installed.length} kurulu` : 'Henüz kurulu skill yok')}
          control={(
            <button className="cx-btn" type="button" onClick={reloadRegistry} disabled={registry.loading} title="Yenile">
              <RefreshCw size={12} className={registry.loading ? 'spin' : ''} />
            </button>
          )} />
        {registry.skills.map((s) => {
          const isIn = installedIds.has(s.id);
          const busy = registry.busy === s.id;
          return (
            <Row key={s.id}
              title={<>{s.name}{s.version && <span className="cx-ver">{s.version}</span>}</>}
              desc={s.description}
              control={(
                <button className={`cx-btn ${isIn ? '' : 'cx-btn-primary'}`} type="button" disabled={busy}
                  onClick={() => skillAction(isIn ? 'removeSkill' : 'installSkill', s.id)}>
                  {busy ? <Loader2 size={12} className="spin" /> : isIn ? 'Kaldır' : 'Kur'}
                </button>
              )} />
          );
        })}
        {registry.installed.filter((s) => !registry.skills.some((r) => r.id === s.id)).map((s) => (
          <Row key={s.id} title={s.name} desc={`.tulvez/skills/${s.id}.md`}
            control={<button className="cx-btn" type="button" onClick={() => skillAction('removeSkill', s.id)}>Kaldır</button>} />
        ))}
      </Section>
      <Section title="Bu proje">
        <Row title="code_skills.md" desc={skills?.exists ? 'Projeye özel kimlik, kurallar ve skill\'ler' : 'Henüz yok — oluşturunca düzenlemek için açılır'}
          control={(
            <button className="cx-btn" type="button" onClick={() => vscode.postMessage({ type: 'openSkillsFile' })}>
              {skills?.exists ? 'Aç' : 'Oluştur'}
            </button>
          )} />
      </Section>
    </>
  );

  // ── Ana sayfa ─────────────────────────────────────────────────────
  const renderMain = () => (
    <>
      <Section title="Bağlantı">
        <Row title="Sağlayıcı" desc={provider.hint}
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
          <Row title="Adres" desc="OpenAI uyumlu uç noktanın /v1 adresi">
            <input className="cx-input" type="text" spellCheck={false} aria-label="Base URL"
              value={cfg.baseUrl || ''} placeholder="https://openrouter.ai/api/v1"
              onChange={(e) => apply({ baseUrl: e.target.value })} />
            <div className="cx-examples">
              <span className="cx-examples-label">Örnek</span>
              {ENDPOINT_EXAMPLES.map((x) => (
                <button key={x.url} type="button" className="cx-example" title={`${x.name} — kullanmak için tıkla`}
                  onClick={() => apply({ baseUrl: x.url })}>
                  <span className="cx-example-url">{x.url}</span>
                  <span className="cx-example-name">{x.name}</span>
                </button>
              ))}
            </div>
          </Row>
        )}
        {cfg.aiProvider === 'ollama' && (
          <Row title="Ollama sunucusu" desc="Anahtar gerekmez">
            <input className="cx-input" type="text" spellCheck={false} aria-label="Ollama sunucusu"
              value={cfg.ollamaUrl || ''} placeholder="http://localhost:11434"
              onChange={(e) => apply({ ollamaUrl: e.target.value })} />
          </Row>
        )}
        {cfg.aiProvider !== 'ollama' && (
          <Row title="API anahtarı"
            desc={cfg.apiKey ? 'Kayıtlı · VS Code SecretStorage' : cfg.aiProvider === 'custom' ? 'İsteğe bağlı' : 'Gerekli'}
            control={(
              <button className="cx-btn" type="button" onClick={() => setKeyOpen((o) => !o)}>
                {keyOpen ? 'Kapat' : cfg.apiKey ? 'Değiştir' : 'Ekle'}
              </button>
            )}>
            {(keyOpen || (!savedKey && cfg.aiProvider !== 'custom')) && (
              <div className="cx-input-group">
                <input className="cx-input cx-mono" type={showKey ? 'text' : 'password'} aria-label="API anahtarı"
                  value={cfg.apiKey || ''} placeholder={provider.keyHint ?? 'Anahtar'} autoComplete="off" spellCheck={false}
                  onChange={(e) => { setKeyOpen(true); apply({ apiKey: e.target.value }); }} />
                <button className="tz-ghost-icon" type="button" title={showKey ? 'Gizle' : 'Göster'} onClick={() => setShowKey((x) => !x)}>
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                {cfg.apiKey && (
                  <button className="tz-ghost-icon" type="button" title="Anahtarı sil" onClick={clearKey}><Trash2 size={13} /></button>
                )}
              </div>
            )}
          </Row>
        )}
        <Row title="Durum"
          desc={<span className="cx-status"><span className={`cx-dot ${modelsError ? 'is-err' : models !== null ? 'is-ok' : ''}`} />{connectionText}</span>}
          control={(
            <button className="cx-btn" type="button" onClick={testConnection} disabled={modelsLoading}>
              <RefreshCw size={12} className={modelsLoading ? 'spin' : ''} /> Sına
            </button>
          )}>
          {modelsError && <div className="cx-alert"><AlertTriangle size={13} /><span>{modelsError}</span></div>}
          {quotas.map((qt) => (
            <div className="cx-note" key={qt.model}>
              <b title={qt.model}>{prettyModel(qt.model)}</b> kotası doldu
              {qt.retryAt ? ` · ${new Date(qt.retryAt).toLocaleString('tr-TR')} sonra` : ''}
            </div>
          ))}
        </Row>
      </Section>

      <Section title="Model">
        <Row title="Varsayılan model" desc={connected ? 'Sohbette model seçilmediğinde kullanılır' : 'Önce sağlayıcıya bağlan'}
          control={connected ? (
            <ModelMenu value={cfg.model} models={models ?? []} allowDefault={false} side="bottom" align="end" onSelect={pickModel}
              emptyText={modelsLoading ? 'Modeller yükleniyor…' : 'Model listesi boş — bağlantıyı sına'}
              trigger={(
                <button className="cx-select" type="button" title={cfg.model}>
                  <span className="cx-select-label">{cfg.model ? prettyModel(cfg.model) : 'Seç'}</span>
                  <ChevronDown size={12} className="cx-chev" />
                </button>
              )} />
          ) : undefined} />
      </Section>

      <Section title="İzinler">
        <div className="cx-radios" role="radiogroup" aria-label="İzinler">
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

      <Section title="Kişiselleştirme">
        <Row title="Düşünüşü göster" desc="Modelin akıl yürütmesi yanıtın üstünde"
          control={<Switch label="Düşünüşü göster" checked={cfg.showThinking} onChange={(x) => apply({ showThinking: x })} />} />
        <Row title="Düzenlemeleri işaretle" desc="Tulvez'in yazdığı satırlar editörde vurgulanır"
          control={<Switch label="Düzenlemeleri işaretle" checked={cfg.showAiEdits} onChange={(x) => apply({ showAiEdits: x })} />} />
        <Row title="Seçili kodu gönder" desc="Editörde seçili kod mesajla birlikte gider"
          control={<Switch label="Seçili kodu gönder" checked={cfg.sendCodeContext} onChange={(x) => apply({ sendCodeContext: x })} />} />
        <Row title="GitHub'da ek katkıcı" desc="Commit'lerde yanında tulvez-code[bot] görünür"
          control={<Switch label="GitHub'da ek katkıcı" checked={cfg.gitCoAuthor} onChange={(x) => apply({ gitCoAuthor: x })} />} />
        <Row title="Kendi commit'inde yazar Tulvez" desc="Tulvez commit'i kendisi atınca yazar Tulvez Code olur, sen ek katkıcı olursun; GitHub katkıcılar listesinde görünür"
          control={<Switch label="Kendi commit'inde yazar Tulvez" checked={!!cfg.gitBotAuthor} onChange={(x) => apply({ gitBotAuthor: x })} />} />
      </Section>

      <Section title="Skills">
        <Row title="Skill'leri yönet"
          desc={registry.installed.length ? `${registry.installed.length} kurulu · depodan ekle ya da kaldır` : 'Depodan skill ekle'}
          control={<ChevronRight size={15} className="cx-chev" />}
          onClick={() => setView('skills')} />
      </Section>

      <div className="cx-links">
        <button type="button" className="cx-link" onClick={() => vscode.postMessage({ type: 'openSkillsFile' })}>
          <FileText size={13} /> code_skills.md'yi aç
        </button>
        <button type="button" className="cx-link" onClick={() => vscode.postMessage({ type: 'openVsSettings' })}>
          <ExternalLink size={13} /> Tüm ayarlar (VS Code)
        </button>
      </div>
    </>
  );

  return (
    <div className="cx-page">
      <header className="cx-top">
        <button className="tz-icon-btn" type="button" onClick={handleBack} title={view === 'main' ? 'Sohbete dön' : 'Ayarlara dön'}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span className="cx-top-title">{view === 'main' ? 'Ayarlar' : 'Skills'}</span>
        <span className={`cx-saved ${saved ? 'is-on' : ''}`} aria-live="polite"><Check size={12} /> Kaydedildi</span>
      </header>

      <div className="cx-body">
        {!loaded ? (
          <div className="cx-loading"><Loader2 size={15} className="spin" /><span>Yükleniyor…</span></div>
        ) : view === 'main' ? renderMain() : renderSkills()}
      </div>
    </div>
  );
}
