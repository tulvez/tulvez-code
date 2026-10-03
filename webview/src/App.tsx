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
  Check,
  ChevronDown,
  Copy,
  GitBranch,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import './styles.css';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

const QUICK_ACTIONS = [
  { icon: <MessageSquare size={13} />, label: 'Dosyayı açıkla', prompt: 'Bu dosyayı açıklar mısın?' },
  { icon: <GitBranch size={13} />, label: 'Git değişikliklerini incele', prompt: 'Git değişikliklerimi incele' },
  { icon: <Sparkles size={13} />, label: 'Commit mesajı oluştur', prompt: 'Commit mesajı oluştur' },
];

const SKILLS = [
  'Çalışma alanını analiz et',
  'Git değişikliklerini incele',
  'Commit mesajı oluştur',
  'Kod incelemesi yap',
];

const MODELS = ['Otomatik', 'GPT-4o', 'Gemini 1.5', 'Claude 3.5'];

export function App(): JSX.Element {
  const [workspaceName, setWorkspaceName] = useState('');
  const [input, setInput] = useState('');
  const [model, setModel] = useState('Otomatik');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      if (msg.type === 'initialized') {
        setWorkspaceName(msg.workspaceName);
      } else if (msg.type === 'assistantMessage') {
        setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: msg.text }]);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
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
    <div className="shell">
      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <span className="brand-icon">T</span>
          <span className="brand-name">Tulvez AI</span>
        </div>
        {workspaceName && (
          <span className="header-workspace" title={workspaceName}>{workspaceName}</span>
        )}
        <div className="header-actions">
          <button
            className="icon-btn"
            type="button"
            title="Yeni sohbet"
            onClick={() => setMessages([])}
          >
            <SquarePen size={14} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* Chat area */}
      <div ref={scrollRef} className="chat-area">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Sparkles size={15} strokeWidth={1.6} />
            </div>
            <p className="empty-title">Tulvez AI</p>
            <p className="empty-subtitle">Kodunuz hakkında soru sorun veya aşağıdaki işlemlerden birini seçin.</p>
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
            {messages.map((msg) => (
              <div key={msg.id} className="message-turn">
                <div className="turn-header">
                  <span className={`turn-avatar ${msg.role}`}>
                    {msg.role === 'user' ? 'S' : <Sparkles size={10} strokeWidth={2} />}
                  </span>
                  <span className="turn-name">{msg.role === 'user' ? 'Sen' : 'Tulvez AI'}</span>
                </div>
                <div className="turn-body">{msg.text}</div>
                {msg.role === 'assistant' && (
                  <div className="turn-actions">
                    <button className="turn-action-btn" type="button" title="Kopyala" onClick={() => void copy(msg)}>
                      {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button className="turn-action-btn" type="button" title="Beğen">
                      <ThumbsUp size={12} />
                    </button>
                    <button className="turn-action-btn" type="button" title="Beğenme">
                      <ThumbsDown size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="composer-wrap">
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            ref={textareaRef}
            className="composer-input"
            value={input}
            placeholder="Tulvez AI ile sohbet edin..."
            rows={1}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <div className="composer-footer">
            <div className="composer-left">
              <button className="composer-btn icon-only" type="button" title="Dosya ekle">
                <Paperclip size={13} strokeWidth={1.8} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="composer-btn" type="button">
                    <Sparkles size={12} strokeWidth={1.8} />
                    Beceriler
                    <ChevronDown size={10} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="dropdown-content">
                  {SKILLS.map((s) => (
                    <DropdownMenuItem key={s} className="dropdown-item" onSelect={() => setInput(s)}>
                      {s}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="composer-btn" type="button">
                    {model}
                    <ChevronDown size={10} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="dropdown-content">
                  {MODELS.map((m) => (
                    <DropdownMenuItem key={m} className="dropdown-item" onSelect={() => setModel(m)}>
                      {m}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="composer-right">
              <span className="hint">⏎ gönder</span>
              <button className="send-btn" type="submit" title="Gönder" disabled={!input.trim()}>
                <Send size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
