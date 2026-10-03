import { useEffect, useState } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import {
  Check, ChevronLeft, Eye, EyeOff, FolderOpen,
  Lock, Shield, Terminal, Zap,
} from 'lucide-react';

interface Props { onBack: () => void; }

const DEFAULT: TulvezSettings = {
  aiProvider: 'openai', apiKey: '',
  autoApproveCommands: false, allowShellCommands: false,
  telemetry: false, sendCodeContext: false,
};

const PROVIDERS = [
  { id: 'openai' as const,    label: 'OpenAI',          hint: 'GPT-4o · GPT-4 Turbo',    color: '#10a37f' },
  { id: 'gemini' as const,    label: 'Google Gemini',   hint: 'Gemini 1.5 Pro · Flash',   color: '#4285f4' },
  { id: 'anthropic' as const, label: 'Anthropic',       hint: 'Claude 3.5 Sonnet · Haiku', color: '#d97706' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />
  );
}

export function SettingsPage({ onBack }: Props) {
  const [cfg, setCfg] = useState<TulvezSettings>(DEFAULT);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wsName, setWsName] = useState('');
  const [tab, setTab] = useState<'ai' | 'commands' | 'privacy' | 'workspace'>('ai');

  useEffect(() => {
    vscode.postMessage({ type: 'getSettings' });
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'settingsData') setCfg(e.data.settings as TulvezSettings);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const set = <K extends keyof TulvezSettings>(key: K, val: TulvezSettings[K]) =>
    setCfg((prev) => ({ ...prev, [key]: val }));

  const save = () => {
    vscode.postMessage({ type: 'saveSettings', settings: cfg });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const createWorkspace = () => {
    const name = wsName.trim();
    if (!name) return;
    vscode.postMessage({ type: 'sendMessage', text: `Yeni çalışma alanı oluştur: ${name}` });
    setWsName('');
    onBack();
  };

  const TABS = [
    { id: 'ai' as const,        label: 'AI',         icon: <Zap size={12} /> },
    { id: 'commands' as const,  label: 'Komutlar',   icon: <Terminal size={12} /> },
    { id: 'privacy' as const,   label: 'Gizlilik',   icon: <Shield size={12} /> },
    { id: 'workspace' as const, label: 'Çalışma',    icon: <FolderOpen size={12} /> },
  ];

  return (
    <div className="settings-page">
      <div className="settings-topbar">
        <button className="settings-back" type="button" onClick={onBack}>
          <ChevronLeft size={14} strokeWidth={2} /><span>Geri</span>
        </button>
        <span className="settings-topbar-title">Ayarlar</span>
        <button className="settings-save-btn" type="button" onClick={save}>
          {saved ? <><Check size={11} /> Kaydedildi</> : 'Kaydet'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="settings-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button"
            className={`settings-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="settings-body">

        {/* AI Tab */}
        {tab === 'ai' && (
          <>
            <div className="s-label">Sağlayıcı</div>
            <div className="provider-grid">
              {PROVIDERS.map((p) => (
                <button key={p.id} type="button"
                  className={`provider-card ${cfg.aiProvider === p.id ? 'active' : ''}`}
                  style={{ '--p-color': p.color } as React.CSSProperties}
                  onClick={() => set('aiProvider', p.id)}>
                  <span className="provider-dot" />
                  <div>
                    <div className="provider-name">{p.label}</div>
                    <div className="provider-models">{p.hint}</div>
                  </div>
                  {cfg.aiProvider === p.id && <Check size={12} className="provider-check" />}
                </button>
              ))}
            </div>

            <div className="s-label" style={{ marginTop: 14 }}>API Anahtarı (BYOK)</div>
            <div className="s-hint">Anahtarınız VS Code SecretStorage'da şifreli saklanır. Hiçbir sunucuya gönderilmez.</div>
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
                <span className="api-key-dot" />
                Anahtar girildi — kaydetmeyi unutmayın
              </div>
            )}
          </>
        )}

        {/* Commands Tab */}
        {tab === 'commands' && (
          <>
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
            <div className="s-info-box">
              <Terminal size={11} />
              <span>Komutlar çalışma alanı kök dizininde çalışır. Güvenmediğiniz projelerde otomatik onayı kapatın.</span>
            </div>
          </>
        )}

        {/* Privacy Tab */}
        {tab === 'privacy' && (
          <>
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
              <p>
                API anahtarınız yalnızca VS Code SecretStorage'da saklanır.
                Kodunuz, siz açıkça izin vermedikçe Tulvez sunucularına gönderilmez.
                Tüm AI istekleri doğrudan seçtiğiniz sağlayıcıya gider.
              </p>
            </div>
          </>
        )}

        {/* Workspace Tab */}
        {tab === 'workspace' && (
          <>
            <div className="s-label">Yeni Çalışma Alanı</div>
            <div className="s-hint">Proje adı girin, Tulvez Code klasör yapısını oluşturur.</div>
            <div className="ws-create-row">
              <input className="ws-input" type="text" placeholder="proje-adı"
                value={wsName} onChange={(e) => setWsName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createWorkspace(); }} />
              <button className="ws-create-btn" type="button" onClick={createWorkspace} disabled={!wsName.trim()}>
                Oluştur
              </button>
            </div>
            <div className="s-info-box" style={{ marginTop: 10 }}>
              <FolderOpen size={11} />
              <span>Çalışma alanı oluşturma özelliği AI sağlayıcısı bağlandığında tam olarak çalışacak.</span>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
