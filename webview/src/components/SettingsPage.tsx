import { useEffect, useRef, useState } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import {
  Check, ChevronLeft, Eye, EyeOff, FolderOpen, Lock,
  RefreshCw, Shield, Sparkles, Terminal, Bot, Palette, Search, Settings2,
} from 'lucide-react';

interface Props {
  onBack: () => void;
  onModelChange?: (model: string) => void;
}

const DEFAULT: TulvezSettings = {
  aiProvider: 'openai', model: 'gpt-4o-mini', apiKey: '', ollamaUrl: 'http://localhost:11434',
  baseUrl: 'https://opencode.ai/zen/v1',
  autoApproveCommands: false, allowShellCommands: false,
  telemetry: false, sendCodeContext: false, showAiEdits: true, showModels: true, showThinking: true,
};

const PROVIDERS = [
  { id: 'openai' as const,    label: 'OpenAI',        hint: 'GPT-4o · GPT-4o-mini · o1',        color: '#10a37f', emoji: '🟢' },
  { id: 'anthropic' as const, label: 'Anthropic',     hint: 'Claude Sonnet · Haiku · Opus',      color: '#d97706', emoji: '🟠' },
  { id: 'gemini' as const,    label: 'Google Gemini', hint: 'Gemini 2.5 Flash · Pro',            color: '#4285f4', emoji: '🔵' },
  { id: 'groq' as const,      label: 'Groq',          hint: 'Llama · Mixtral · Ultra hızlı',     color: '#f97316', emoji: '🟡' },
  { id: 'opencode' as const,  label: 'OpenCode Zen',  hint: 'Claude · GPT · Gemini · Grok',      color: '#7c3aed', emoji: '🟣' },
  { id: 'custom' as const,    label: 'Özel Endpoint', hint: 'OpenRouter · LM Studio · vLLM',     color: '#64748b', emoji: '⚙️' },
  { id: 'ollama' as const,    label: 'Ollama',        hint: 'Yerel · Ücretsiz · Tamamen gizli',  color: '#a78bfa', emoji: '🏠' },
];

const MODEL_HINTS: [RegExp, string][] = [
  [/gemini-2\.5-flash-lite/, 'Ücretsiz · yüksek limit'],
  [/gemini-2\.5-flash/, 'Ücretsiz · hızlı'],
  [/gemini-2\.5-pro/, 'Gelişmiş · kotada sınırlı'],
  [/flash/i, 'Ücretsiz · hızlı'],
  [/gpt-4o-mini/, 'Uygun fiyatlı'],
  [/gpt-4o/, 'Gelişmiş'],
  [/o1/, 'Akıl yürütme'],
  [/claude-3-5-haiku/, 'Hızlı'],
  [/claude/, 'Gelişmiş'],
  [/llama/i, 'Ücretsiz (Groq)'],
  [/mixtral|gemma/i, 'Ücretsiz (Groq)'],
];

function modelHint(model: string, provider: string): string {
  if (provider === 'ollama') return 'Yerel · ücretsiz';
  return MODEL_HINTS.find(([re]) => re.test(model))?.[1] ?? '';
}

type Tab = 'model' | 'provider' | 'other';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'model',    label: 'Model',     icon: <Sparkles size={13} /> },
  { id: 'provider', label: 'Sağlayıcı', icon: <Bot size={13} /> },
  { id: 'other',    label: 'Diğer',     icon: <Settings2 size={13} /> },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />
  );
}

function SettingRow({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="s-row">
      <div>
        <div className="s-row-label">{label}</div>
        {hint && <div className="s-row-hint">{hint}</div>}
      </div>
      {control}
    </div>
  );
}

interface Quota { model: string; retryAt?: number }

export function SettingsPage({ onBack, onModelChange }: Props) {
  const [cfg, setCfg] = useState<TulvezSettings>(DEFAULT);
  const [showKey, setShowKey] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsCreated, setWsCreated] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [skills, setSkills] = useState<{ exists: boolean; path: string; skills: string[] } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('model');
  const [saved, setSaved] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    vscode.postMessage({ type: 'getSettings' });
    vscode.postMessage({ type: 'getSkills' });
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'settingsData') {
        if (!saveTimer.current) setCfg({ ...(e.data.settings as TulvezSettings), showModels: true });
      }
      if (e.data?.type === 'modelsList') {
        setModels(e.data.models as string[]);
        setModelsError((e.data.error as string) ?? '');
        setModelsLoading(false);
      }
      if (e.data?.type === 'skillsStatus') {
        setSkills(e.data as unknown as { exists: boolean; path: string; skills: string[] });
      }
      if (e.data?.type === 'quotaInfo' && e.data.limited) {
        setQuotas((prev) => {
          const rest = prev.filter((q) => q.model !== e.data.model);
          return [...rest, { model: e.data.model, retryAt: e.data.retryAt }];
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (cfg.aiProvider !== 'ollama' && !cfg.apiKey) { setModels(null); return; }
    const t = window.setTimeout(() => {
      setModelsLoading(true);
      vscode.postMessage({ type: 'listModels' });
    }, 800);
    return () => window.clearTimeout(t);
  }, [cfg.aiProvider, cfg.apiKey]);

  const set = <K extends keyof TulvezSettings>(key: K, val: TulvezSettings[K]) => {
    setCfg((prev) => {
      const next = { ...prev, [key]: val };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        vscode.postMessage({ type: 'saveSettings', settings: next });
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2000);
      }, 600);
      return next;
    });
  };

  const selectModel = (m: string) => {
    set('model', m);
    onModelChange?.(m);
  };

  const createWorkspace = () => {
    const name = wsName.trim();
    if (!name) return;
    vscode.postMessage({ type: 'createWorkspace', name });
    setWsCreated(name);
    setWsName('');
  };

  const refreshModels = () => {
    setModelsLoading(true);
    setModels(null);
    vscode.postMessage({ type: 'listModels' });
  };

  const currentProvider = PROVIDERS.find((p) => p.id === cfg.aiProvider);
  const modelList = models ?? [];
  const filteredModels = modelSearch.trim()
    ? modelList.filter((m) => m.toLowerCase().includes(modelSearch.toLowerCase()))
    : modelList;

  const apiKeyPlaceholder =
    cfg.aiProvider === 'openai' ? 'sk-…' :
    cfg.aiProvider === 'gemini' ? 'AIza…' :
    cfg.aiProvider === 'groq' ? 'gsk_…' : 'sk-ant-…';

  return (
    <div className="settings-page">
      {/* Topbar */}
      <div className="sp-topbar">
        <button className="icon-btn" type="button" onClick={onBack} title="Geri">
          <ChevronLeft size={15} strokeWidth={2} />
        </button>
        <span className="sp-topbar-title">Ayarlar</span>
        {saved && (
          <span className="sp-saved-badge">
            <Check size={10} /> Kaydedildi
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="sp-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button"
            className={`sp-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="sp-body">

        {/* ── MODEL ── */}
        {activeTab === 'model' && (
          <div className="sp-section">
            {cfg.aiProvider !== 'ollama' && !cfg.apiKey ? (
              <div className="sp-empty-state">
                <Lock size={20} />
                <p>Modelleri görmek için önce</p>
                <p>Sağlayıcı sekmesinden API anahtarını gir.</p>
              </div>
            ) : (
              <>
                {/* Toolbar: aktif model + yenile */}
                <div className="sp-model-toolbar">
                  {cfg.model && (
                    <span className="sp-model-active-badge" title={cfg.model}>
                      <Check size={10} /> {cfg.model}
                    </span>
                  )}
                  <button className="sp-refresh-btn" type="button" onClick={refreshModels} disabled={modelsLoading}>
                    <RefreshCw size={12} className={modelsLoading ? 'spin' : ''} />
                    {modelsLoading ? 'Yükleniyor…' : 'Yenile'}
                  </button>
                </div>

                {/* Arama */}
                <div className="sp-search-wrap">
                  <Search size={13} className="sp-search-icon" />
                  <input
                    className="sp-search-input"
                    type="text"
                    placeholder="Model ara… (örn. flash, :free, gpt)"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                  />
                  {modelSearch && (
                    <button className="sp-search-clear" type="button" onClick={() => setModelSearch('')}>×</button>
                  )}
                </div>

                {modelsError && <div className="sp-error-banner">{modelsError}</div>}

                <div className="sp-model-list">
                  {modelsLoading && modelList.length === 0 ? (
                    <div className="sp-empty-state"><p>Modeller yükleniyor…</p></div>
                  ) : filteredModels.length === 0 ? (
                    <div className="sp-empty-state"><p>"{modelSearch}" ile eşleşen model yok.</p></div>
                  ) : filteredModels.map((m) => (
                    <button key={m} type="button"
                      className={`sp-model-card ${cfg.model === m ? 'active' : ''}`}
                      style={{ '--p-color': currentProvider?.color } as React.CSSProperties}
                      onClick={() => selectModel(m)}>
                      <div className="sp-model-card-info">
                        <span className="sp-model-name" title={m}>{m}</span>
                        {modelHint(m, cfg.aiProvider) && (
                          <span className="sp-model-hint">{modelHint(m, cfg.aiProvider)}</span>
                        )}
                      </div>
                      {cfg.model === m && <Check size={12} className="sp-provider-check" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── SAĞLAYICI ── */}
        {activeTab === 'provider' && (
          <div className="sp-section">
            <p className="sp-section-desc">Hangi AI servisini kullanmak istiyorsun?</p>
            <div className="sp-provider-grid">
              {PROVIDERS.map((p) => (
                <button key={p.id} type="button"
                  className={`sp-provider-card ${cfg.aiProvider === p.id ? 'active' : ''}`}
                  style={{ '--p-color': p.color } as React.CSSProperties}
                  onClick={() => { set('aiProvider', p.id); set('model', ''); }}>
                  <span className="sp-provider-emoji">{p.emoji}</span>
                  <div className="sp-provider-info">
                    <span className="sp-provider-name">{p.label}</span>
                    <span className="sp-provider-hint">{p.hint}</span>
                  </div>
                  {cfg.aiProvider === p.id && <Check size={13} className="sp-provider-check" />}
                </button>
              ))}
            </div>

            {cfg.aiProvider === 'custom' && (
              <div className="sp-field-group">
                <label className="sp-label">Base URL</label>
                <input className="sp-input" type="text"
                  value={cfg.baseUrl} placeholder="https://openrouter.ai/api/v1"
                  onChange={(e) => set('baseUrl', e.target.value)} />
                <span className="sp-field-hint">
                  Örnekler:<br />
                  OpenRouter → <code>https://openrouter.ai/api/v1</code><br />
                  LM Studio → <code>http://localhost:1234/v1</code><br />
                  vLLM → <code>http://localhost:8000/v1</code><br />
                  Jan → <code>http://localhost:1337/v1</code>
                </span>
              </div>
            )}
            {cfg.aiProvider === 'ollama' && (
              <div className="sp-field-group">
                <label className="sp-label">Ollama Sunucu Adresi</label>
                <input className="sp-input" type="text"
                  value={cfg.ollamaUrl} placeholder="http://localhost:11434"
                  onChange={(e) => set('ollamaUrl', e.target.value)} />
                <span className="sp-field-hint">Ollama'nın çalıştığı adres.</span>
              </div>
            )}

            {cfg.aiProvider !== 'ollama' && (
              <div className="sp-field-group">
                <label className="sp-label"><Lock size={11} /> API Anahtarı</label>
                <div className="sp-key-wrap">
                  <input className="sp-key-input"
                    type={showKey ? 'text' : 'password'}
                    value={cfg.apiKey}
                    placeholder={apiKeyPlaceholder}
                    onChange={(e) => set('apiKey', e.target.value)}
                    autoComplete="off" spellCheck={false} />
                  <button className="sp-key-toggle" type="button"
                    onClick={() => setShowKey((v) => !v)} title={showKey ? 'Gizle' : 'Göster'}>
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {cfg.apiKey ? (
                  <span className="sp-key-ok"><span className="sp-key-dot" />Anahtar girildi — şifreli saklanıyor</span>
                ) : (
                  <span className="sp-field-hint">Anahtarın yalnızca VS Code SecretStorage'da saklanır.</span>
                )}
              </div>
            )}

            {quotas.length > 0 && (
              <div className="sp-field-group">
                <label className="sp-label">Kota Durumu</label>
                {quotas.map((q) => (
                  <div className="sp-quota-row" key={q.model}>
                    <span className="sp-quota-dot" />
                    <span className="sp-quota-model">{q.model}</span>
                    <span className="sp-quota-time">
                      {q.retryAt ? new Date(q.retryAt).toLocaleString('tr-TR') : 'Günlük kota doldu'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DİĞER ── */}
        {activeTab === 'other' && (
          <div className="sp-section">

            {/* Güvenlik */}
            <div className="sp-field-group">
              <label className="sp-label"><Shield size={11} /> Gizlilik</label>
              <div className="s-section">
                <SettingRow
                  label="Kod bağlamı gönder"
                  hint="AI'ya aktif dosya içeriği otomatik eklenir"
                  control={<Toggle checked={cfg.sendCodeContext} onChange={(v) => set('sendCodeContext', v)} />}
                />
                <SettingRow
                  label="Anonim kullanım verisi"
                  hint="Henüz aktif değil"
                  control={<Toggle checked={cfg.telemetry} onChange={(v) => set('telemetry', v)} />}
                />
              </div>
              <div className="sp-privacy-box">
                <Lock size={13} />
                <div>
                  <p className="sp-privacy-title">Verileriniz güvende</p>
                  <p className="sp-privacy-body">
                    API anahtarınız yalnızca VS Code SecretStorage'da şifreli saklanır.
                    Tüm istekler doğrudan seçtiğiniz sağlayıcıya gider.
                  </p>
                </div>
              </div>
            </div>

            {/* Arayüz */}
            <div className="sp-field-group">
              <label className="sp-label"><Palette size={11} /> Arayüz</label>
              <div className="s-section">
                <SettingRow
                  label="Düşünüş metnini göster"
                  hint="Modelin içsel akıl yürütmesini listeler"
                  control={<Toggle checked={cfg.showThinking} onChange={(v) => set('showThinking', v)} />}
                />
                <SettingRow
                  label="AI satırlarını işaretle"
                  hint="Agent'ın yazdığı satırlar editörde vurgulanır"
                  control={<Toggle checked={cfg.showAiEdits} onChange={(v) => set('showAiEdits', v)} />}
                />
              </div>
            </div>

            {/* Skills */}
            <div className="sp-field-group">
              <label className="sp-label"><Sparkles size={11} /> Skills</label>
              <p className="sp-field-hint">
                Ajanın kimliği <code>code_skills.md</code> dosyasından okunur.
                {skills && ` · ${skills.exists ? `${skills.skills.length} skill tanımlı` : 'dosya yok'}`}
              </p>
              <button className="sp-action-btn" type="button"
                onClick={() => vscode.postMessage({ type: 'openSkillsFile' })}>
                {skills?.exists ? 'code_skills.md aç' : 'code_skills.md oluştur'}
              </button>
            </div>

            {/* Araçlar */}
            <div className="sp-field-group">
              <label className="sp-label"><Terminal size={11} /> Araçlar</label>
              <div className="s-section">
                <SettingRow
                  label="Komut çalıştırmaya izin ver"
                  hint="Agent terminal komutları çalıştırabilir"
                  control={<Toggle checked={cfg.allowShellCommands} onChange={(v) => set('allowShellCommands', v)} />}
                />
                <SettingRow
                  label="Otomatik onayla"
                  hint="Her komut için onay sormaz"
                  control={<Toggle checked={cfg.autoApproveCommands} onChange={(v) => set('autoApproveCommands', v)} />}
                />
              </div>
            </div>

            {/* Çalışma Alanı */}
            <div className="sp-field-group">
              <label className="sp-label"><FolderOpen size={11} /> Yeni Çalışma Alanı</label>
              <p className="sp-field-hint">Proje adı girin, VS Code yeni klasörü açar.</p>
              <div className="sp-inline-row">
                <input className="sp-input" type="text" placeholder="proje-adı"
                  value={wsName} onChange={(e) => setWsName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createWorkspace(); }} />
                <button className="sp-action-btn" type="button"
                  onClick={createWorkspace} disabled={!wsName.trim()}>
                  Oluştur
                </button>
              </div>
              {wsCreated && (
                <span className="sp-key-ok"><span className="sp-key-dot" />"{wsCreated}" oluşturuldu</span>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
