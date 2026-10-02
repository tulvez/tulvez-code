import { useEffect, useState } from 'react';
import { vscode } from './services/vscode';
import type { HostToWebviewMessage } from './types';
import './styles.css';

export function App(): JSX.Element {
  const [workspaceName, setWorkspaceName] = useState('Bağlanıyor...');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>) => {
      if (event.data.type === 'initialized') {
        setWorkspaceName(event.data.workspaceName);
      }
      else if (event.data.type === 'assistantMessage') {
        const { text } = event.data;
        setMessages((current) => [...current, text]);
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((current) => [...current, `Sen: ${text}`]);
    vscode.postMessage({ type: 'sendMessage', text });
    setInput('');
  };

  const useSuggestion = (text: string) => {
    setInput(text);
  };

  return (
    <main className="app-shell">
      <header className="header">
        <div className="header-title">
          <span className="copilot-mark">✦</span>
          <span>Copilot</span>
        </div>
        <button className="header-action" type="button" aria-label="Yeni sohbet">＋</button>
        <button className="header-action" type="button" aria-label="Ayarlar">•••</button>
      </header>
      <section className="content">
        <div className="chat-heading">
          <h1>Size nasıl yardımcı olabilirim?</h1>
          <p className="muted">{workspaceName}</p>
        </div>
        <div className="suggestions">
          <button type="button" className="suggestion" onClick={() => useSuggestion('Bu dosyayı açıklar mısın?')}>
            <span className="suggestion-icon">▤</span>
            <span>Bu dosyayı açıkla</span>
          </button>
          <button type="button" className="suggestion" onClick={() => useSuggestion('Çalışma alanımı analiz eder misin?')}>
            <span className="suggestion-icon">⌁</span>
            <span>Çalışma alanımı analiz et</span>
          </button>
          <button type="button" className="suggestion" onClick={() => useSuggestion('Git değişikliklerimi incele')}>
            <span className="suggestion-icon">⑂</span>
            <span>Değişiklikleri incele</span>
          </button>
          <button type="button" className="suggestion" onClick={() => useSuggestion('Commit mesajı oluştur')}>
            <span className="suggestion-icon">✓</span>
            <span>Commit mesajı oluştur</span>
          </button>
        </div>
        <div className="messages" aria-live="polite">
          {messages.map((message, index) => (
            <p key={`${message}-${index}`} className={`message ${message.startsWith('Sen:') ? 'user-message' : 'assistant-message'}`}>
              {message}
            </p>
          ))}
        </div>
      </section>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Copilot'a sorun"
          aria-label="Copilot mesajı"
          rows={1}
        />
        <div className="composer-footer">
          <button className="composer-tool" type="button" aria-label="Dosya ekle">＋</button>
          <span className="composer-hint">⏎ gönder · ⇧⏎ yeni satır</span>
          <button className="send-button" type="submit" aria-label="Gönder">↑</button>
        </div>
      </form>
    </main>
  );
}
