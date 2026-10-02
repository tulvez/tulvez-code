import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { Textarea } from './components/ui/textarea';
import { vscode } from './services/vscode';
import type { HostToWebviewMessage } from './types';
import {
  Check,
  ChevronDown,
  CirclePlus,
  Copy,
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

export function App(): JSX.Element {
  const [workspaceName, setWorkspaceName] = useState('Çalışma alanı');
  const [input, setInput] = useState('');
  const [model, setModel] = useState('Model Seç...');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const nextMessageId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>) => {
      if (event.data.type === 'initialized') {
        setWorkspaceName(event.data.workspaceName);
      } else if (event.data.type === 'assistantMessage') {
        const { text } = event.data;
        setMessages((current) => [
          ...current,
          { id: nextMessageId.current++, role: 'assistant', text },
        ]);
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const copyMessage = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.text);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      { id: nextMessageId.current++, role: 'user', text },
    ]);
    vscode.postMessage({ type: 'sendMessage', text });
    setInput('');
  };

  return (
    <main className="sidebar-shell">
      <header className="sidebar-header">
        <div className="sidebar-title">
          <span className="tulvez-glyph">T</span>
          <span>Tulvez Code</span>
        </div>
        <span className="workspace-label" title={workspaceName}>{workspaceName}</span>
        <Button className="new-chat-button" variant="ghost" size="icon" type="button" aria-label="Yeni sohbet">
          <SquarePen size={15} strokeWidth={1.8} />
        </Button>
      </header>

      <section ref={scrollRef} className="chat-scroll" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-glyph"><Sparkles size={17} strokeWidth={1.6} /></div>
            <p>Nasıl yardımcı olabilirim?</p>
            <span>Çalışma alanınız hakkında soru sorun veya bir görev seçin.</span>
            <div className="starter-actions">
              <button type="button" onClick={() => setInput('Bu dosyayı açıklar mısın?')}>Dosyayı açıkla</button>
              <button type="button" onClick={() => setInput('Git değişikliklerimi incele')}>Değişiklikleri incele</button>
              <button type="button" onClick={() => setInput('Commit mesajı oluştur')}>Commit mesajı yaz</button>
            </div>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <div key={message.id} className={`message-group ${message.role}`}>
                {message.role === 'assistant' && <div className="assistant-avatar"><Sparkles size={12} /></div>}
                <div className="message-body">
                  <div className="message-meta">{message.role === 'assistant' ? 'Tulvez Code' : 'Sen'}</div>
                  <div className="chat-message">{message.text}</div>
                  {message.role === 'assistant' && (
                    <div className="message-actions">
                      <button type="button" onClick={() => void copyMessage(message)} aria-label="Mesajı kopyala">
                        {copiedId === message.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      <button type="button" aria-label="Beğen"><ThumbsUp size={12} /></button>
                      <button type="button" aria-label="Beğenme"><ThumbsDown size={12} /></button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="composer-wrap">
        <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <div className="composer-top">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="AI ile sohbet edin"
              aria-label="AI ile sohbet edin"
              rows={1}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="skills-trigger" type="button">
                  <Sparkles size={12} /> Beceriler <ChevronDown size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Çalışma alanını analiz et</DropdownMenuItem>
                <DropdownMenuItem>Git değişikliklerini incele</DropdownMenuItem>
                <DropdownMenuItem>Commit mesajı oluştur</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="composer-bottom">
            <Button className="add-button" variant="ghost" size="icon" type="button" aria-label="Dosya ekle"><CirclePlus size={19} strokeWidth={1.7} /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="model-trigger" type="button">
                  <ChevronDown className="chevron" size={12} /> {model}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setModel('Otomatik')}>Otomatik</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setModel('OpenAI')}>OpenAI</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setModel('Gemini')}>Gemini</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button className="send-button" type="submit" size="icon" aria-label="Gönder">
              {input.trim() ? <Send size={15} /> : <Paperclip size={15} />}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
