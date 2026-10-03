import { useEffect, useState } from 'react';
import { vscode } from '../services/vscode';
import type { TulvezSettings } from '../types';
import { Check, ChevronLeft, Eye, EyeOff, Lock, Shield, Terminal, Zap } from 'lucide-react';

interface Props {
  onBack: () => void;
}

const DEFAULT: TulvezSettings = {
  aiProvider: 'openai',
  apiKey: '',
  autoApproveCommands: false,
  allowShellCommands: false,
  telemetry: false,
  sendCodeContext: false,
};

const PROVIDERS = [
  { id: 'openai' as const, label: 'OpenAI', hint: 'GPT-4o, GPT-4 Turbo' },
  { id: 'gemini' as const, label: 'Google Gemini', hint: 'Gemini 1.5 Pro' },
  { id: 'anthropic' as const, label: 'Anthropic', hint: 'Claude 3.5 Sonnet' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage({ onBack }: Props) {
  const [cfg, setCfg] = useState<TulvezSettings>(DEFAULT);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    vscode.postMessage({ type: 'getSettings' });
  }, []);

  // settingsData mesajını dinle
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

  return (
    <div className="settings-page">
      <div className="settings-topbar">
        <button className="settings-back" type="button" onClick={onBack}>
          <ChevronLeft size={14} strokeWidth={2} />
          <span>Geri</span>
        </button>
        <span className="settings-topbar-title">Ayarlar</span>
        <button className="settings-save-btn" type="button" onClick={save}>
          {saved ? <><Check size={12} /> Kaydedildi</> : 'Kaydet'}
        </button>
      </div>

      <div className="settings-body">

        {/* BYOK */}
        <Section icon={<Zap size={13} />} title="Yapay Zeka Sağlayıcısı">
          <Row label="Sağlayıcı">
            <div className="provider-list">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`provider-btn ${cfg.aiProvider === p.id ? 'active' : ''}`}
                  onClick={() => set('aiProvider', p.id)}
                >
                  <span className="provider-label">{p.label}</span>
                  <span className="provider-hint">{p.hint}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="API Anahtarı" hint="SecretStorage'da şifreli saklanır">
            <div className="api-key-wrap">
              <input
                className="api-key-input"
                type={showKey ? 'text' : 'password'}
                value={cfg.apiKey}
                placeholder="sk-..."
                onChange={(e) => set('apiKey', e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="api-key-toggle"
                type="button"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? 'Gizle' : 'Göster'}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </Row>
        </Section>

        {/* Komut izinleri */}
        <Section icon={<Terminal size={13} />} title="Komut Çalıştırma">
          <Row label="Komut çalıştırmaya izin ver" hint="Terminal komutlarını çalıştırabilir">
            <Toggle checked={cfg.allowShellCommands} onChange={(v) => set('allowShellCommands', v)} />
          </Row>
          <Row label="Otomatik onayla" hint="Her komut için onay sormaz">
            <Toggle
              checked={cfg.autoApproveCommands}
              onChange={(v) => set('autoApproveCommands', v)}
            />
          </Row>
        </Section>

        {/* Gizlilik */}
        <Section icon={<Shield size={13} />} title="Gizlilik">
          <Row label="Kod bağlamı gönder" hint="AI'ya aktif dosya içeriği eklenir">
            <Toggle checked={cfg.sendCodeContext} onChange={(v) => set('sendCodeContext', v)} />
          </Row>
          <Row label="Anonim kullanım verisi" hint="Henüz aktif değil">
            <Toggle checked={cfg.telemetry} onChange={(v) => set('telemetry', v)} />
          </Row>
        </Section>

        {/* Gizlilik notu */}
        <div className="privacy-note">
          <Lock size={11} />
          <p>
            API anahtarınız yalnızca VS Code SecretStorage'da saklanır ve hiçbir Tulvez sunucusuna
            gönderilmez. Kodunuz, siz açıkça izin vermedikçe üçüncü taraflarla paylaşılmaz.
          </p>
        </div>

      </div>
    </div>
  );
}
