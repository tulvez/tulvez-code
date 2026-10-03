import { useEffect, useRef, useState } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import { Check, ChevronLeft, Eye, EyeOff, FolderOpen, Lock, Shield, Terminal, Zap } from 'lucide-react';

interface Props { onBack: () => void; }

const DEFAULT: TulvezSettings = {
  aiProvider: 'openai', model: 'gpt-4o-mini', apiKey: '', ollamaUrl: 'http://localhost:11434',
  baseUrl: 'https://opencode.ai/zen/v1',
  autoApproveCommands: false, allowShellCommands: false,
  telemetry: false, sendCodeContext: false, showAiEdits: true,
};

const PROVIDERS = [
  { id: 'openai' as const,    label: 'OpenAI',        hint: 'GPT-4o · GPT-4o-mini · o1',    color: '#10a37f' },
  { id: 'anthropic' as const, label: 'Anthropic',     hint: 'Claude 3.5 Sonnet · Haiku',    color: '#d97706' },
  { id: 'gemini' as const,    label: 'Google Gemini', hint: 'Gemini 2.5 Pro · Flash · Flash-Lite', color: '#4285f4' },
  { id: 'groq' as const,     label: 'Groq',          hint: 'Llama 3.3 · Mixtral · Çok Hızlı', color: '#f97316' },
  { id: 'opencode' as const, label: 'OpenCode Zen',  hint: 'Claude · GPT · Gemini · Grok tek gateway', color: '#7c3aed' },
  { id: 'custom' as const,   label: 'Özel (OpenAI uyumlu)', hint: 'OpenRouter · LM Studio · vLLM · herhangi bir endpoint', color: '#64748b' },
  { id: 'ollama' as const,    label: 'Ollama',        hint: 'Yerel · Ücretsiz · Gizli',     color: '#a78bfa' },
];

const MODEL_HINTS: [RegExp, string][] = [
  [/gemini-2\.5-flash-lite/, 'Ücretsiz katman · en yüksek limit'],
  [/gemini-2\.5-flash/, 'Ücretsiz katman · hızlı'],
  [/gemini-2\.5-pro/, 'Gelişmiş · ücretsiz kotada sınırlı'],
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
  if (provider === 'ollama') return 'Yerel · ücretsiz · çevrimdışı';
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

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <div className="s-section-title">{icon}<span>{label}</span></div>;
}

export function SettingsPage({ onBack }: Props) {
  const [cfg, setCfg] = useState<TulvezSettings>(DEFAULT);
  const [showKey, setShowKey] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsCreated, setWsCreated] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { vscode.postMessage({ type: 'getSettings' }); }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'settingsData') setCfg(e.data.settings as TulvezSettings);
      if (e.data?.type === 'modelsList') {
        setModels(e.data.models as string[]);
        setModelsError((e.data.error as string) ?? '');
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
    const t = window.setTimeout(() => vscode.postMessage({ type: 'listModels' }), 800);
    return () => window.clearTimeout(t);
  }, [cfg.aiProvider, cfg.apiKey]);

  const set = <K extends keyof TulvezSettings>(key: K, val: TulvezSettings[K]) => {
    setCfg((prev) => {
      const next = { ...prev, [key]: val };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
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

        <div className="s-card">
          <SectionTitle icon={<Zap size={12} />} label="AI Sağlayıcı" />
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
        </div>

        <div className="s-card">
          <SectionTitle icon={<Zap size={12} />} label="Model" />
          {cfg.aiProvider !== 'ollama' && !cfg.apiKey ? (
            <div className="s-hint">Modelleri görmek için önce API anahtarınızı girin.</div>
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
        </div>

        {quotas.length > 0 && (
          <div className="s-card">
            <SectionTitle icon={<Terminal size={12} />} label="Kota / Limit Bilgisi" />
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
          </div>
        )}

        {cfg.aiProvider === 'custom' && (
          <div className="s-card">
            <SectionTitle icon={<Terminal size={12} />} label="Endpoint (Base URL)" />
            <div className="s-hint">OpenAI uyumlu API adresi. Örnekler: https://opencode.ai/zen/v1, https://openrouter.ai/api/v1, http://localhost:1234/v1</div>
            <input className="ws-input" type="text"
              value={cfg.baseUrl} placeholder="https://..."
              onChange={(e) => set('baseUrl', e.target.value)} />
          </div>
        )}

        {cfg.aiProvider === 'opencode' && (
          <div className="s-card">
            <SectionTitle icon={<Lock size={12} />} label="OpenCode Zen" />
            <div className="s-hint">opencode.ai üzerinden kendi bakiyenle kullan. Anahtarını opencode.ai/zen panelinden al, buraya yapıştır. Modeller hesabındaki gerçek listeden gelir.</div>
          </div>
        )}

        {cfg.aiProvider === 'ollama' && (
          <div className="s-card">
            <SectionTitle icon={<Terminal size={12} />} label="Ollama Sunucu" />
            <div className="s-hint">Ollama'nın çalıştığı adres.</div>
            <input className="ws-input" type="text"
              value={cfg.ollamaUrl} placeholder="http://localhost:11434"
              onChange={(e) => set('ollamaUrl', e.target.value)} />
          </div>
        )}

        {cfg.aiProvider !== 'ollama' && (
          <div className="s-card">
            <SectionTitle icon={<Lock size={12} />} label="API Anahtarı (BYOK)" />
            <div className="s-hint">Anahtarınız VS Code SecretStorage'da şifreli saklanır. Tulvez sunucularına gönderilmez.</div>
            <div className="api-key-wrap">
              <input className="api-key-input"
                type={showKey ? 'text' : 'password'}
                value={cfg.apiKey}
                placeholder={cfg.aiProvider === 'openai' ? 'sk-...' : cfg.aiProvider === 'gemini' ? 'AIza...' : cfg.aiProvider === 'groq' ? 'gsk_...' : 'sk-ant-...'}
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
          </div>
        )}

        <div className="s-card">
          <SectionTitle icon={<Terminal size={12} />} label="Komutlar" />
          <div className="s-section">
            <div className="s-row">
              <div>
                <div className="s-row-label">Komut çalıştırmaya izin ver</div>
                <div className="s-row-hint">Terminal komutları çalıştırılabilir</div>
              </div>
              <Toggle checked={cfg.allowShellCommands} onChange={(v) => set('allowShellCommands', v)} />
            </div>
            <div className="s-row">
              <div>
                <div className="s-row-label">Otomatik onayla</div>
                <div className="s-row-hint">Her komut için onay sormaz</div>
              </div>
              <Toggle checked={cfg.autoApproveCommands} onChange={(v) => set('autoApproveCommands', v)} />
            </div>
          </div>
        </div>

        <div className="s-card">
          <SectionTitle icon={<Shield size={12} />} label="Gizlilik" />
          <div className="s-section">
            <div className="s-row">
              <div>
                <div className="s-row-label">Kod bağlamı gönder</div>
                <div className="s-row-hint">AI'ya aktif dosya içeriği eklenir</div>
              </div>
              <Toggle checked={cfg.sendCodeContext} onChange={(v) => set('sendCodeContext', v)} />
            </div>
            <div className="s-row">
              <div>
                <div className="s-row-label">AI satırlarını işaretle</div>
                <div className="s-row-hint">Agent'ın yazdığı satırlar editörde vurgulanır</div>
              </div>
              <Toggle checked={cfg.showAiEdits} onChange={(v) => set('showAiEdits', v)} />
            </div>
            <div className="s-row">
              <div>
                <div className="s-row-label">Anonim kullanım verisi</div>
                <div className="s-row-hint">Henüz aktif değil</div>
              </div>
              <Toggle checked={cfg.telemetry} onChange={(v) => set('telemetry', v)} />
            </div>
          </div>
          <div className="privacy-note">
            <Lock size={11} />
            <p>API anahtarınız yalnızca VS Code SecretStorage'da saklanır. Kodunuz, siz açıkça izin vermedikçe Tulvez sunucularına gönderilmez.</p>
          </div>
        </div>

        <div className="s-card">
          <SectionTitle icon={<FolderOpen size={12} />} label="Çalışma Alanı" />
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
        </div>

      </div>
    </div>
  );
}
