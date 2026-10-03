import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { SettingsPage } from './components/SettingsPage';
import { vscode } from './services/vscode';
import type { HostToWebviewMessage } from './types';
import {
  Check, ChevronDown, ChevronLeft, CirclePlus, Clock, Copy, GitBranch, Hammer,
  MessageSquare, Send, Settings, Sparkles, SquarePen,
  Terminal, ThumbsDown, ThumbsUp, X, Zap,
} from 'lucide-react';
import './styles.css';

const MIN_WIDTH = 220;

type AgentMode = 'ask' | 'plan' | 'build';
type Page = 'chat' | 'settings' | 'history';
interface ChatMessage { id: number; role: 'user' | 'assistant' | 'command'; text: string; exitCode?: number; mode?: AgentMode; animated?: boolean; }
interface ChatSession { id: number; title: string; messages: ChatMessage[]; mode: AgentMode; ts: number; }
interface RunConfirm { command: string; }

const MODES: { id: AgentMode; label: string; sublabel: string; icon: React.ReactNode; hint: string; color: string; placeholder: string }[] = [
  { id: 'ask',   label: 'Ask',   sublabel: 'Tulvez Code\'a sorun',    icon: <MessageSquare size={12} />, hint: 'Soru sor, açıkla',  color: 'var(--mode-ask)',   placeholder: "Tulvez Code'a sorun..." },
  { id: 'plan',  label: 'Plan',  sublabel: 'Tulvez Code ile planla',   icon: <Sparkles size={12} />,      hint: 'Adım adım planla', color: 'var(--mode-plan)',  placeholder: 'Tulvez Code ile planlayın...' },
  { id: 'build', label: 'Build', sublabel: 'Tulvez Code ile inşa et', icon: <Hammer size={12} />,        hint: 'Kod yaz, uygula',  color: 'var(--mode-build)', placeholder: 'Tulvez Code ile inşa edin...' },
];

const SLASH_COMMANDS = [
  { cmd: '/run',     hint: 'Terminal komutu çalıştır' },
  { cmd: '/review',  hint: 'Kod incelemesi yap' },
  { cmd: '/commit',  hint: 'Commit mesajı oluştur' },
  { cmd: '/diff',    hint: 'Git değişikliklerini göster' },
  { cmd: '/explain', hint: 'Seçili kodu açıkla' },
];

const QUICK_ACTIONS = [
  { icon: <MessageSquare size={13} />, label: 'Dosyayı açıkla',              prompt: 'Bu dosyayı açıklar mısın?' },
  { icon: <GitBranch size={13} />,     label: 'Git değişikliklerini incele',  prompt: 'Git değişikliklerimi incele' },
  { icon: <Terminal size={13} />,      label: 'Komut çalıştır',               prompt: '/run git status' },
  { icon: <Sparkles size={13} />,      label: 'Commit mesajı oluştur',        prompt: 'Commit mesajı oluştur' },
];

const SKILLS = [
  { label: 'Çalışma alanını analiz et',   prompt: 'Çalışma alanımı analiz et' },
  { label: 'Git değişikliklerini incele', prompt: 'Git değişikliklerimi incele' },
  { label: 'Commit mesajı oluştur',       prompt: 'Commit mesajı oluştur' },
  { label: 'Kod incelemesi yap',          prompt: 'Kodumu incele ve geri bildirim ver' },
];

const MODELS = ['Otomatik', 'GPT-4o', 'Gemini 1.5', 'Claude 3.5'];

function TooNarrow() {
  return (
    <div className="too-narrow">
      <span className="too-narrow-icon"><Zap size={12} /></span>
      <p className="too-narrow-title">Sığmıyor</p>
      <p className="too-narrow-sub">Genişletin</p>
    </div>
  );
}

function useTyping(full: string, active: boolean, speed = 8) {
  // active sadece ilk render'da okunur, sonra değişmez
  const initialActive = useRef(active).current;
  const [displayed, setDisplayed] = useState(initialActive ? '' : full);
  const [done, setDone] = useState(!initialActive);

  useEffect(() => {
    if (!initialActive) return;
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      i += 3;
      setDisplayed(full.slice(0, i));
      if (i < full.length) window.setTimeout(tick, speed);
      else { setDisplayed(full); setDone(true); }
    };
    window.setTimeout(tick, speed);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // boş dep array — sadece mount'ta bir kez çalışır

  return { displayed, done };
}

function AssistantBubble({ text, onCopy, onRunHint, copied, mode, animate }: {
  text: string; onCopy: () => void; onRunHint: () => void; copied: boolean; mode: AgentMode; animate: boolean;
}) {
  const { displayed, done } = useTyping(text, animate);
  return (
    <>
      <div className="turn-body">
        {displayed}
        {!done && <span className="typing-cursor" />}
      </div>
      <div className="turn-actions">
        <button className="turn-action-btn" type="button" title="Kopyala" onClick={onCopy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        <button className="turn-action-btn" type="button" title="Beğen"><ThumbsUp size={12} /></button>
        <button className="turn-action-btn" type="button" title="Beğenme"><ThumbsDown size={12} /></button>
        <button className="turn-action-btn run-hint" type="button" title="Komut çalıştır" onClick={onRunHint}>
          <Terminal size={12} />
        </button>
      </div>
    </>
  );
}

export function App(): JSX.Element {
  const [workspaceName, setWorkspaceName] = useState('');
  const [logoUri, setLogoUri] = useState('');
  const [input, setInput] = useState('');
  const [model, setModel] = useState('Otomatik');
  const [mode, setMode] = useState<AgentMode>('build');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [runConfirm, setRunConfirm] = useState<RunConfirm | null>(null);
  const [page, setPage] = useState<Page>('chat');
  const [slashOpen, setSlashOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const sessionIdRef = useRef(1);
  const pendingRun = useRef<string | null>(null);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      if (msg.type === 'initialized') {
        setWorkspaceName(msg.workspaceName);
        setLogoUri(msg.logoUri);
      } else if (msg.type === 'assistantMessage') {
        setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: msg.text, mode, animated: true }]);
      } else if (msg.type === 'commandResult') {
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'command',
          text: msg.output || '(çıktı yok)', exitCode: msg.exitCode,
        }]);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? window.innerWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, runConfirm]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    setSlashOpen(val === '/');
    if (val !== '/' && slashOpen) setSlashOpen(false);
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setSlashOpen(false);

    const runMatch = /^\/run\s+(.+)$/i.exec(text);
    if (runMatch) {
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
      pendingRun.current = runMatch[1];
      setRunConfirm({ command: runMatch[1] });
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
    vscode.postMessage({ type: 'sendMessage', text });
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const approveRun = (autoApprove = false) => {
    if (!runConfirm) return;
    if (autoApprove) {
      vscode.postMessage({ type: 'saveSettings', settings: {
        aiProvider: 'openai', apiKey: '', autoApproveCommands: true,
        allowShellCommands: true, telemetry: false, sendCodeContext: false,
      }});
    }
    vscode.postMessage({ type: 'runCommand', command: runConfirm.command });
    pendingRun.current = null;
    setRunConfirm(null);
  };

  const copy = async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.text);
    setCopiedId(msg.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const saveCurrentSession = (msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    const title = msgs.find((m) => m.role === 'user')?.text.slice(0, 40) ?? 'Sohbet';
    setSessions((prev) => {
      const existing = prev.findIndex((s) => s.id === sessionIdRef.current);
      const session: ChatSession = { id: sessionIdRef.current, title, messages: msgs, mode, ts: Date.now() };
      if (existing >= 0) { const next = [...prev]; next[existing] = session; return next; }
      return [session, ...prev];
    });
  };

  const newChat = () => {
    saveCurrentSession(messages);
    sessionIdRef.current = Date.now();
    setMessages([]);
    setRunConfirm(null);
  };

  const restoreSession = (s: ChatSession) => {
    saveCurrentSession(messages);
    sessionIdRef.current = s.id;
    setMessages(s.messages);
    setMode(s.mode);
    setPage('chat');
  };

  const modeClass = `composer mode-${mode}`;
  const currentMode = MODES.find((m) => m.id === mode)!;

  return (
    <div className="shell" ref={shellRef}>
      <div className="shell-content">
        {width < MIN_WIDTH ? <TooNarrow /> : page === 'settings' ? (
          <SettingsPage onBack={() => setPage('chat')} />
        ) : page === 'history' ? (
          <div className="history-page">
            <div className="history-topbar">
              <button className="icon-btn" type="button" onClick={() => setPage('chat')}><ChevronLeft size={15} strokeWidth={2} /></button>
              <span className="history-title">Sohbet Geçmişi</span>
            </div>
            <div className="history-list">
              {sessions.length === 0 ? (
                <div className="history-empty"><Clock size={20} /><p>Henüz geçmiş yok</p></div>
              ) : sessions.map((s) => (
                <button key={s.id} type="button" className="history-item" onClick={() => restoreSession(s)}>
                  <span className={`history-mode-dot mode-dot-${s.mode}`} />
                  <div className="history-item-body">
                    <span className="history-item-title">{s.title}</span>
                    <span className="history-item-meta">{s.messages.length} mesaj · {new Date(s.ts).toLocaleDateString('tr-TR')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="header">
              <div className="header-brand">
                {logoUri ? <img src={logoUri} className="brand-logo" alt="Tulvez" /> : <span className="brand-icon">T</span>}
                <span className="brand-name">Tulvez Code</span>
              </div>
              {workspaceName && <span className="header-workspace" title={workspaceName}>{workspaceName}</span>}
              <div className="header-actions">
                <button className="icon-btn" type="button" title="Geçmiş" onClick={() => setPage('history')}>
                  <Clock size={15} strokeWidth={1.8} />
                </button>
                <button className="icon-btn" type="button" title="Yeni sohbet" onClick={newChat}>
                  <SquarePen size={15} strokeWidth={1.8} />
                </button>
                <button className="icon-btn" type="button" title="Ayarlar" onClick={() => setPage('settings')}>
                  <Settings size={15} strokeWidth={1.8} />
                </button>
              </div>
            </header>

            {/* Chat */}
            <div ref={scrollRef} className="chat-area">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    {logoUri ? <img src={logoUri} className="empty-logo" alt="Tulvez" /> : <Sparkles size={24} strokeWidth={1.6} />}
                  </div>
                  <p className="empty-title">Tulvez Code</p>
                  <p className="empty-subtitle">Kodunuz hakkında soru sorun veya bir işlem seçin.</p>
                  <div className="quick-actions">
                    {QUICK_ACTIONS.map((a) => (
                      <button key={a.label} type="button" className="quick-action-btn"
                        onClick={() => { setInput(a.prompt); textareaRef.current?.focus(); }}>
                        {a.icon}{a.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="message-list">
                  {messages.map((msg) => {
                    if (msg.role === 'command') return (
                      <div key={msg.id} className="message-turn command">
                        <div className="command-header">
                          <Terminal size={11} /><span>terminal</span>
                          {(msg.exitCode ?? 0) !== 0 && <span className="command-exit-err">exit {msg.exitCode}</span>}
                        </div>
                        <pre className="command-output">{msg.text}</pre>
                      </div>
                    );
                    return (
                      <div key={msg.id} className={`message-turn ${msg.role}`}>
                        {msg.role === 'assistant' && (
                          <div className="turn-header">
                            <span className={`turn-avatar assistant mode-avatar-${msg.mode ?? 'ask'}`}><Sparkles size={10} strokeWidth={2} /></span>
                          </div>
                        )}
                        {msg.role === 'assistant' ? (
                          <AssistantBubble
                            text={msg.text}
                            mode={msg.mode ?? 'ask'}
                            animate={msg.animated ?? false}
                            copied={copiedId === msg.id}
                            onCopy={() => void copy(msg)}
                            onRunHint={() => { setInput('/run '); textareaRef.current?.focus(); }}
                          />
                        ) : (
                          <div className="turn-body">{msg.text}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Run confirm bar */}
            {runConfirm && (
              <div className="run-confirm-bar">
                <div className="run-confirm-bar-top">
                  <Terminal size={11} /><span>Komut çalıştırma izni</span>
                  <button className="run-confirm-close" type="button" onClick={() => setRunConfirm(null)}><X size={11} /></button>
                </div>
                <code className="run-confirm-cmd">{runConfirm.command}</code>
                <div className="run-confirm-actions">
                  <button className="rcb rcb-approve" type="button" onClick={() => approveRun(false)}>
                    <Check size={11} /> Onayla
                  </button>
                  <button className="rcb rcb-always" type="button" onClick={() => approveRun(true)}>
                    Sürekli onayla
                  </button>
                  <button className="rcb rcb-deny" type="button" onClick={() => setRunConfirm(null)}>
                    İptal
                  </button>
                </div>
              </div>
            )}

            {/* Slash command menu */}
            {slashOpen && (
              <div className="slash-menu">
                {SLASH_COMMANDS.map((s) => (
                  <button key={s.cmd} type="button" className="slash-item"
                    onClick={() => { setInput(s.cmd + ' '); setSlashOpen(false); textareaRef.current?.focus(); }}>
                    <span className="slash-cmd">{s.cmd}</span>
                    <span className="slash-hint">{s.hint}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="composer-wrap">
              <div className="mode-bar">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="mode-trigger" type="button"
                      style={{ '--m-color': currentMode.color } as React.CSSProperties}>
                      {currentMode.icon}
                      <span>{currentMode.label}</span>
                      <ChevronDown size={10} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="dropdown-content">
                    {MODES.map((m) => (
                      <DropdownMenuItem key={m.id} className={`dropdown-item mode-item-${m.id} ${mode === m.id ? 'mode-item-active' : ''}`}
                        onSelect={() => {
                          setMode(m.id);
                          window.setTimeout(() => textareaRef.current?.focus(), 50);
                        }}>
                        {m.icon}
                        <div className="mode-item-labels">
                          <span>{m.label}</span>
                          <span className="mode-item-hint">{m.sublabel}</span>
                        </div>
                        {mode === m.id && <Check size={11} style={{ marginLeft: 'auto' }} />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <form className={modeClass} onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea
                  ref={textareaRef}
                  className="composer-input"
                  value={input}
                  placeholder={currentMode.placeholder}
                  rows={1}
                  onChange={(e) => { handleInputChange(e.target.value); autoResize(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setSlashOpen(false);
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                />
                <div className="composer-footer">
                  <div className="composer-left">
                    <button className="composer-btn icon-only" type="button" title="Ekle">
                      <CirclePlus size={15} strokeWidth={1.8} />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="composer-btn" type="button">{model}<ChevronDown size={10} /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="dropdown-content">
                        {MODELS.map((m) => (
                          <DropdownMenuItem key={m} className="dropdown-item" onSelect={() => setModel(m)}>{m}</DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="composer-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="composer-btn" type="button">
                          <Sparkles size={12} strokeWidth={1.8} />Beceriler<ChevronDown size={10} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="dropdown-content">
                        {SKILLS.map((s) => (
                          <DropdownMenuItem key={s.label} className="dropdown-item"
                            onSelect={() => { setInput(s.prompt); window.setTimeout(() => textareaRef.current?.focus(), 50); }}>
                            {s.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button className={`send-btn send-btn-${mode}`} type="submit" title="Gönder" disabled={!input.trim()}>
                      <Send size={13} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
