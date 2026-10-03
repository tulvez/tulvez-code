import { useEffect, useRef, useState } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import { Check, ChevronLeft, Eye, EyeOff, FolderOpen, Lock, Shield, Terminal, Zap } from 'lucide-react';

interface Props { onBack: () => void; }

const DEFAULT: TulvezSettings = {
  aiProvider: 'openai', model: 'gpt-4o-mini', apiKey: '', ollamaUrl: 'http://localhost:11434',
  autoApproveCommands: false, allowShellCommands: false,
  telemetry: false, sendCodeContext: false,
};

const PROVIDERS = [
  { id: 'openai' as const,    label: 'OpenAI',        hint: 'GPT-4o · GPT-4o-mini · o1',    color: '#10a37f',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o1'] },
  { id: 'anthropic' as const, label: 'Anthropic',     hint: 'Claude 3.5 Sonnet · Haiku',    color: '#d97706',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'] },
  { id: 'gemini' as const,    label: 'Google Gemini', hint: 'Gemini 1.5 Pro · Flash · 2.0', color: '#4285f4',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'] },
  { id: 'ollama' as const,    label: 'Ollama',        hint: 'Yerel · Ücretsiz · Gizli',     color: '#a78bfa',
    models: ['llama3', 'llama3.1', 'codellama', 'mistral', 'deepseek-coder'] },
];

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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { vscode.postMessage({ type: 'getSettings' }); }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'settingsData') setCfg(e.data.settings as TulvezSettings);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Otomatik kaydet — her değişiklikte 600ms debounce
  const set = <K extends keyof TulvezSettings>(key: K, val: TulvezSettings[K]) => {
    const next = { ...cfg, [key]: val };
    setCfg(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      vscode.postMessage({ type: 'saveSettings', settings: next });
    }, 600);
  };

  const createWorkspace = () => {
    const name = wsName.trim();
    if (!name) return;
    vscode.postMessage({ type: 'createWorkspace', name });
    setWsCreated(name);
    setWsName('');
  };

  return (
    <div className="settings-page">
      {/* Topbar: geri butonu üstte, Ayarlar başlığı altında */}
      <div className="settings-topbar">
        <button className="settings-back-btn" type="button" onClick={onBack}>
          <ChevronLeft size={14} strokeWidth={2.5} />
        </button>
        <span className="settings-topbar-title">Ayarlar</span>
      </div>

      <div className="settings-body">

        {/* AI Sağlayıcı */}
        <SectionTitle icon={<Zap size={12} />} label="AI Sağlayıcı" />
        <div className="provider-grid">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button"
              className={`provider-card ${cfg.aiProvider === p.id ? 'active' : ''}`}
              style={{ '--p-color': p.color } as React.CSSProperties}
              onClick={() => { set('aiProvider', p.id); set('model', p.models[0]); }}>
              <span className="provider-dot" />
              <div>
                <div className="provider-name">{p.label}</div>
                <div className="provider-models">{p.hint}</div>
              </div>
              {cfg.aiProvider === p.id && <Check size={12} className="provider-check" />}
            </button>
          ))}
        </div>

        {/* Model seçimi */}
        {(() => {
          const p = PROVIDERS.find((p) => p.id === cfg.aiProvider);
          if (!p) return null;
          return (
            <>
              <SectionTitle icon={<Zap size={12} />} label="Model" />
              <div className="provider-grid">
                {p.models.map((m) => (
                  <button key={m} type="button"
                    className={`provider-card ${cfg.model === m ? 'active' : ''}`}
                    style={{ '--p-color': p.color } as React.CSSProperties}
                    onClick={() => set('model', m)}>
                    <span className="provider-dot" />
                    <div className="provider-name">{m}</div>
                    {cfg.model === m && <Check size={12} className="provider-check" />}
                  </button>
                ))}
              </div>
            </>
          );
        })()}

        {/* Ollama URL */}
        {cfg.aiProvider === 'ollama' && (
          <>
            <SectionTitle icon={<Terminal size={12} />} label="Ollama Sunucu" />
            <div className="s-hint">Ollama'nın çalıştığı adres. Varsayılan: http://localhost:11434</div>
            <input className="ws-input" type="text"
              value={cfg.ollamaUrl}
              placeholder="http://localhost:11434"
              onChange={(e) => set('ollamaUrl', e.target.value)} />
          </>
        )}

        {/* API Anahtarı — Ollama'da gerekmez */}
        {cfg.aiProvider !== 'ollama' && (
          <>
            <SectionTitle icon={<Lock size={12} />} label="API Anahtarı (BYOK)" />
            <div className="s-hint">Anahtarınız VS Code SecretStorage'da şifreli saklanır.</div>
        <div className="api-key-wrap">
          <input className="api-key-input"
            type={showKey ? 'text' : 'password'}
            value={cfg.apiKey}
            placeholder={cfg.aiProvider === 'openai' ? 'sk-...' : cfg.aiProvider === 'gemini' ? 'AIza...' : 'sk-ant-...'}
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
          </>
        )}

        {/* Komutlar */}
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

        {/* Gizlilik */}
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

        {/* Çalışma Alanı */}
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
  );
}
