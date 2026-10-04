import { useEffect, useRef, useState } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import { Check, ChevronLeft, Eye, EyeOff, FolderOpen, Lock, Shield, Sparkles, Terminal, Zap } from 'lucide-react';

interface Props { onBack: () => void; }

const DEFAULT: TulvezSettings = {
  aiProvider: 'openai', model: 'gpt-4o-mini', apiKey: '', ollamaUrl: 'http://localhost:11434',
  baseUrl: 'https://opencode.ai/zen/v1',
  autoApproveCommands: false, allowShellCommands: false,
  telemetry: false, sendCodeContext: false, showAiEdits: true, showModels: false, showThinking: true,
};

const PROVIDERS = [
  { id: 'openai' as const,    label: 'OpenAI',        hint: 'GPT-4o · GPT-4o-mini · o1', color: '#10a37f' },
  { id: 'anthropic' as const, label: 'Anthropic',     hint: 'Claude · Sonnet · Haiku', color: '#d97706' },
  { id: 'gemini' as const,    label: 'Google Gemini', hint: 'Gemini 2.5 · Flash · Pro', color: '#4285f4' },
  { id: 'groq' as const,     label: 'Groq',          hint: 'Llama · Mixtral · Hızlı', color: '#f97316' },
  { id: 'opencode' as const, label: 'OpenCode Zen',  hint: 'Claude · GPT · Gemini · Grok', color: '#7c3aed' },
  { id: 'custom' as const,   label: 'Özel (OpenAI uyumlu)', hint: 'OpenRouter · LM Studio · vLLM', color: '#64748b' },
  { id: 'ollama' as const,    label: 'Ollama',        hint: 'Yerel · Ücretsiz · Gizli', color: '#a78bfa' },
];

const MODEL_HINTS: [RegExp, string][] = [
  [/gemini-2\.5-flash-lite/, 'Ücretsiz katman · yüksek limit'],
  [/gemini-2\.5-flash/, 'Ücretsiz katman · hızlı'],
  [/gemini-2\.5-pro/, 'Gelişmiş · kotada sınırlı'],
  [/flash/i, 'Ücretsiz katman · hızlı'],
  [/gpt-4o-mini/, 'Uygun fiyatlı · ücretli'],
  [/gpt-4o/, 'Gelişmiş · ücretli'],
  [/o1/, 'Akıl yürütme · ücretli'],
  [/claude-3-5-haiku/, 'Hızlı · ücretli'],
  [/claude/, 'Gelişmiş · ücretli'],
  [/llama/i, 'Ücretsiz (Groq) · hızlı'],
  [/mixtral|gemma/i, 'Ücretsiz (Groq)'],
];

function modelHint(model: string, provider: string): string {
  if (provider === 'ollama') return 'Yerel · ücretsiz';
  const found = MODEL_HINTS.find(([re]) => re.test(model));
  return found ? found[1] : '';
}

interface Quota { model: string; retryAt?: number }

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="s-card">
      <div className="s-section-title">{icon}<span>{label}</span></div>
      {children}
    </div>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
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

export function SettingsPage({ onBack }: Props) {
  const [cfg, setCfg] = useState<TulvezSettings>(DEFAULT);
  const [showKey, setShowKey] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsCreated, setWsCreated] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [skills, setSkills] = useState<{ exists: boolean; path: string; skills: string[] } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { vscode.postMessage({ type: 'getSettings' }); vscode.postMessage({ type: 'getSkills' }); }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'settingsData') {
        if (!saveTimer.current) setCfg(e.data.settings as TulvezSettings);
      }
      if (e.data?.type === 'modelsList') {
        setModels(e.data.models as string[]);
        setModelsError((e.data.error as string) ?? '');
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
    if (!cfg.showModels) return;
    if (cfg.aiProvider !== 'ollama' && !cfg.apiKey) { setModels(null); return; }
    const t = window.setTimeout(() => vscode.postMessage({ type: 'listModels' }), 800);
    return () => window.clearTimeout(t);
  }, [cfg.aiProvider, cfg.apiKey, cfg.showModels]);

  const set = <K extends keyof TulvezSettings>(key: K, val: TulvezSettings[K]) => {
    setCfg((prev) => {
      const next = { ...prev, [key]: val };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        vscode.postMessage({ type: 'saveSettings', settings: next });
      }, 600);
      return next;
    });
  };

  const createWorkspace = () => {
    const name = wsName.trim();
    if (!name) return;
    vscode.postMessage({ type: 'createWorkspace', name });
    setWsCreated(name);
    setWsName('');
  };

  const modelList = models && models.length > 0 ? models : [];

  return (
    <div className="settings-page">
      <div className="settings-topbar">
        <button className="settings-back-btn" type="button" onClick={onBack}>
          <ChevronLeft size={14} strokeWidth={2.5} />
        </button>
        <span className="settings-topbar-title">Ayarlar</span>
      </div>

      <div className="settings-body">

        {/* Provider */}
        <Section icon={<Zap size={12} />} label="AI Sağlayıcı">
          <div className="provider-grid">
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button"
                className={`provider-card ${cfg.aiProvider === p.id ? 'active' : ''}`}
                style={{ '--p-color': p.color } as React.CSSProperties}
                onClick={() => { set('aiProvider', p.id); set('model', ''); }}>
                <span className="provider-dot" />
                <div>
                  <div className="provider-name">{p.label}</div>
                  <div className="provider-models">{p.hint}</div>
                </div>
                {cfg.aiProvider === p.id && <Check size={12} className="provider-check" />}
              </button>
            ))}
          </div>
        </Section>

        {/* Model */}
        {cfg.showModels && (
          <Section icon={<Zap size={12} />} label="Model">
            {cfg.aiProvider !== 'ollama' && !cfg.apiKey ? (
              <div className="s-hint">Modelleri görmek için önce API anahtarını girin.</div>
            ) : (
              <>
                {modelsError && <div className="s-hint">Model listesi alınamadı: {modelsError}</div>}
                <div className="provider-grid">
                  {modelList.map((m) => (
                    <button key={m} type="button"
                      className={`provider-card ${cfg.model === m ? 'active' : ''}`}
                      style={{ '--p-color': PROVIDERS.find((p) => p.id === cfg.aiProvider)?.color } as React.CSSProperties}
                      onClick={() => set('model', m)}>
                      <span className="provider-dot" />
                      <div>
                        <div className="provider-name">{m}</div>
                        <div className="model-hint">{modelHint(m, cfg.aiProvider)}</div>
                      </div>
                      {cfg.model === m && <Check size={12} className="provider-check" />}
                    </button>
                  ))}
                  {modelList.length === 0 && !modelsError && <div className="s-hint">Model listesi yükleniyor…</div>}
                </div>
                <button className="ws-create-btn" type="button" style={{ alignSelf: 'flex-start' }}
                  onClick={() => vscode.postMessage({ type: 'listModels' })}>
                  Modelleri yenile
                </button>
              </>
            )}
          </Section>
        )}

        {/* Quotas */}
        {quotas.length > 0 && (
          <Section icon={<Terminal size={12} />} label="Kota / Limit">
            {quotas.map((q) => (
              <div className="quota-row" key={q.model}>
                <span className="quota-dot" />
                <span>{q.model}</span>
                <span className="quota-time">
                  {q.retryAt ? `Sıfırlanma: ${new Date(q.retryAt).toLocaleString('tr-TR')}` : 'Günlük kota doldu'}
                </span>
              </div>
            ))}
            <div className="s-hint">Kalan kotayı sağlayıcının panelinden takip edebilirsiniz.</div>
          </Section>
        )}

        {/* Custom base URL */}
        {cfg.aiProvider === 'custom' && (
          <Section icon={<Terminal size={12} />} label="Endpoint">
            <div className="s-hint">OpenAI uyumlu API adresi.</div>
            <input className="ws-input" type="text"
              value={cfg.baseUrl} placeholder="https://…"
              onChange={(e) => set('baseUrl', e.target.value)} />
          </Section>
        )}

        {/* OpenCode Zen */}
        {cfg.aiProvider === 'opencode' && (
          <Section icon={<Lock size={12} />} label="OpenCode Zen">
            <div className="s-hint">opencode.ai'dan aldığın anahtarını yapıştır.</div>
          </Section>
        )}

        {/* Ollama URL */}
        {cfg.aiProvider === 'ollama' && (
          <Section icon={<Terminal size={12} />} label="Ollama Sunucu">
            <div className="s-hint">Ollama'nın çalıştığı adres.</div>
            <input className="ws-input" type="text"
              value={cfg.ollamaUrl} placeholder="http://localhost:11434"
              onChange={(e) => set('ollamaUrl', e.target.value)} />
          </Section>
        )}

        {/* API Key */}
        {cfg.aiProvider !== 'ollama' && (
          <Section icon={<Lock size={12} />} label="API Anahtarı">
            <div className="s-hint">Anahtarınız yalnızca VS Code SecretStorage'da saklanır.</div>
            <div className="api-key-wrap">
              <input className="api-key-input"
                type={showKey ? 'text' : 'password'}
                value={cfg.apiKey}
                placeholder={cfg.aiProvider === 'openai' ? 'sk-…' : cfg.aiProvider === 'gemini' ? 'AIza…' : cfg.aiProvider === 'groq' ? 'gsk_…' : 'sk-ant-…'}
                onChange={(e) => set('apiKey', e.target.value)}
                autoComplete="off" spellCheck={false} />
              <button className="api-key-toggle" type="button"
                onClick={() => setShowKey((v) => !v)} title={showKey ? 'Gizle' : 'Göster'}>
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            {cfg.apiKey && (
              <div className="api-key-status">
                <span className="api-key-dot" />Anahtar girildi — otomatik kaydedildi
              </div>
            )}
          </Section>
        )}

        {/* Commands */}
        <Section icon={<Terminal size={12} />} label="Komutlar">
          <div className="s-section">
            <Row label="Komut çalıştırmaya izin ver" hint="Terminal komutları çalıştırılabilir"
              control={<Toggle checked={cfg.allowShellCommands} onChange={(v) => set('allowShellCommands', v)} />} />
            <Row label="Otomatik onayla" hint="Her komut için onay sormaz"
              control={<Toggle checked={cfg.autoApproveCommands} onChange={(v) => set('autoApproveCommands', v)} />} />
          </div>
        </Section>

        {/* Privacy */}
        <Section icon={<Shield size={12} />} label="Gizlilik">
          <div className="s-section">
            <Row label="Kod bağlamı gönder" hint="AI'ya aktif dosya içeriği eklenir"
              control={<Toggle checked={cfg.sendCodeContext} onChange={(v) => set('sendCodeContext', v)} />} />
            <Row label="Anonim kullanım verisi" hint="Henüz aktif değil"
              control={<Toggle checked={cfg.telemetry} onChange={(v) => set('telemetry', v)} />} />
          </div>
          <div className="privacy-note">
            <Lock size={11} />
            <p>Anahtarınız yalnızca VS Code SecretStorage'da saklanır. Kodunuz, izin vermedikçe Tulvez sunucularına gönderilmez.</p>
          </div>
        </Section>

        {/* Skills */}
        <Section icon={<Sparkles size={12} />} label="Skills">
          <div className="s-hint">
            Ajanın kimliği ve yetenekleri çalışma alanındaki <code>code_skills.md</code> dosyasından okunur.
          </div>
          {skills && (
            <div className="s-hint">
              Durum: {skills.exists ? `${skills.skills.length} skill tanımlı` : 'dosya yok (varsayılan kimlik kullanılıyor)'}
            </div>
          )}
          <div className="ws-create-row">
            <button className="ws-create-btn" type="button" onClick={() => vscode.postMessage({ type: 'openSkillsFile' })}>
              {skills?.exists ? 'code_skills.md aç' : 'code_skills.md oluştur'}
            </button>
          </div>
        </Section>

        {/* Appearance */}
        <Section icon={<Zap size={12} />} label="Arayüz">
          <div className="s-section">
            <Row label="Model seçimini göster" hint="Kapalıyken sadece varsayılan kullanılır"
              control={<Toggle checked={cfg.showModels} onChange={(v) => set('showModels', v)} />} />
            <Row label="Düşünüş metnini göster" hint="Modelin içsel düşünmesini listeler"
              control={<Toggle checked={cfg.showThinking} onChange={(v) => set('showThinking', v)} />} />
            <Row label="AI satırlarını işaretle" hint="Agent'ın yazdığı satırlar editörde vurgulanır"
              control={<Toggle checked={cfg.showAiEdits} onChange={(v) => set('showAiEdits', v)} />} />
          </div>
        </Section>

        {/* Workspace */}
        <Section icon={<FolderOpen size={12} />} label="Çalışma Alanı">
          <div className="s-hint">Proje adı girin, VS Code yeni klasörü açar.</div>
          <div className="ws-create-row">
            <input className="ws-input" type="text" placeholder="proje-adı"
              value={wsName} onChange={(e) => setWsName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createWorkspace(); }} />
            <button className="ws-create-btn" type="button" onClick={createWorkspace} disabled={!wsName.trim()}>
              Oluştur
            </button>
          </div>
          {wsCreated && (
            <div className="api-key-status">
              <span className="api-key-dot" />"{wsCreated}" oluşturuldu
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}