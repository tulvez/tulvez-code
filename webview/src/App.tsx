import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { vscode } from './services/vscode';
import type { HostToWebviewMessage } from './types';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CirclePlus,
  Copy,
  GitBranch,
  MessageSquare,
  Send,
  Sparkles,
  SquarePen,
  Terminal,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import './styles.css';

const MIN_WIDTH = 280;

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'command';
  text: string;
  exitCode?: number;
}

const QUICK_ACTIONS = [
  { icon: <MessageSquare size={13} />, label: 'Dosyayı açıkla', prompt: 'Bu dosyayı açıklar mısın?' },
  { icon: <GitBranch size={13} />, label: 'Git değişikliklerini incele', prompt: 'Git değişikliklerimi incele' },
  { icon: <Terminal size={13} />, label: 'Komut çalıştır', prompt: '/run git status' },
  { icon: <Sparkles size={13} />, label: 'Commit mesajı oluştur', prompt: 'Commit mesajı oluştur' },
];

const SKILLS = [
  'Çalışma alanını analiz et',
  'Git değişikliklerini incele',
  'Commit mesajı oluştur',
  'Kod incelemesi yap',
];

const MODELS = ['Otomatik', 'GPT-4o', 'Gemini 1.5', 'Claude 3.5'];

// Seed'li LCG rastgele binary
function lcg(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
const rand = lcg(0xdeadbeef);
const BINARY_CHARS = Array.from({ length: 600 }, () => (rand() > 0.5 ? '1' : '0'));
const BINARY_OPACITIES = Array.from({ length: 600 }, () => 0.3 + rand() * 0.7);

function TooNarrow(): JSX.Element {
  return (
    <div className="too-narrow">
      <div className="too-narrow-binary" aria-hidden="true" />
      <div className="too-narrow-content">
        <span className="too-narrow-icon"><Sparkles size={16} strokeWidth={1.6} /></span>
        <p className="too-narrow-title">Bileşenler boyuta sığmıyor</p>
        <p className="too-narrow-sub">Sidebar kenarını sürükleyerek genişletin</p>
        <button
          className="too-narrow-btn"
          type="button"
          onClick={() => vscode.postMessage({ type: 'expandSidebar' })}
        >
          Genişlet <ArrowRight size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  const [workspaceName, setWorkspaceName] = useState('');
  const [logoUri, setLogoUri] = useState('');
  const [input, setInput] = useState('');
  const [model, setModel] = useState('Otomatik');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
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
        setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: msg.text }]);
      } else if (msg.type === 'commandResult') {
        setMessages((prev) => [...prev, {
          id: nextId.current++,
          role: 'command',
          text: msg.output || '(çıktı yok)',
          exitCode: msg.exitCode,
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
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? window.innerWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;

    // /run <komut> sözdizimi
    const runMatch = /^\/run\s+(.+)$/i.exec(text);
    if (runMatch) {
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
      vscode.postMessage({ type: 'runCommand', command: runMatch[1] });
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
    vscode.postMessage({ type: 'sendMessage', text });
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const copy = async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.text);
    setCopiedId(msg.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="shell" ref={shellRef}>
      <div className="shell-binary" aria-hidden="true">
        {BINARY_CHARS.map((ch, i) => (
          <span key={i} style={{ opacity: BINARY_OPACITIES[i] }}>{ch}</span>
        ))}
      </div>
      <div className="shell-content">
      {width < MIN_WIDTH ? (
        <TooNarrow />
      ) : (
        <>
          <header className="header">
            <div className="header-brand">
              {logoUri
                ? <img src={logoUri} className="brand-logo" alt="Tulvez" />
                : <span className="brand-icon">T</span>
              }
              <span className="brand-name">Tulvez Code</span>
            </div>
            {workspaceName && (
              <span className="header-workspace" title={workspaceName}>{workspaceName}</span>
            )}
            <div className="header-actions">
              <button className="icon-btn" type="button" title="Yeni sohbet" onClick={() => setMessages([])}>
                <SquarePen size={14} strokeWidth={1.8} />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="chat-area">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  {logoUri
                    ? <img src={logoUri} className="empty-logo" alt="Tulvez" />
                    : <Sparkles size={15} strokeWidth={1.6} />
                  }
                </div>
                <p className="empty-title">Tulvez Code</p>
                <p className="empty-subtitle">Kodunuz hakkında soru sorun veya bir işlem seçin.</p>
                <div className="quick-actions">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      className="quick-action-btn"
                      onClick={() => { setInput(a.prompt); textareaRef.current?.focus(); }}
                    >
                      {a.icon}
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="message-list">
                {messages.map((msg) => {
                  if (msg.role === 'command') {
                    return (
                      <div key={msg.id} className="message-turn command">
                        <div className="command-header">
                          <Terminal size={11} />
                          <span>terminal</span>
                          {msg.exitCode !== 0 && <span className="command-exit-err">exit {msg.exitCode}</span>}
                        </div>
                        <pre className="command-output">{msg.text}</pre>
                      </div>
                    );
                  }
                  return (
                    <div key={msg.id} className={`message-turn ${msg.role}`}>
                      {msg.role === 'assistant' && (
                        <div className="turn-header">
                          <span className="turn-avatar assistant">
                            <Sparkles size={10} strokeWidth={2} />
                          </span>
                        </div>
                      )}
                      <div className="turn-body">{msg.text}</div>
                      {msg.role === 'assistant' && (
                        <div className="turn-actions">
                          <button className="turn-action-btn" type="button" title="Kopyala" onClick={() => void copy(msg)}>
                            {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                          <button className="turn-action-btn" type="button" title="Beğen"><ThumbsUp size={12} /></button>
                          <button className="turn-action-btn" type="button" title="Beğenme"><ThumbsDown size={12} /></button>
                          <button
                            className="turn-action-btn run-hint"
                            type="button"
                            title="Komut çalıştır"
                            onClick={() => { setInput('/run '); textareaRef.current?.focus(); }}
                          >
                            <Terminal size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <textarea
                ref={textareaRef}
                className="composer-input"
                value={input}
                placeholder="Tulvez Code ile inşa edin..."
                rows={1}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                onKeyDown={(e) => {
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
                      <button className="composer-btn" type="button">
                        {model}<ChevronDown size={10} />
                      </button>
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
                        <DropdownMenuItem key={s} className="dropdown-item" onSelect={() => setInput(s)}>{s}</DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button className="send-btn" type="submit" title="Gönder" disabled={!input.trim()}>
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
