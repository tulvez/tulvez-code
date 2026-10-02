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
    setMessages((current) => [...current, `You: ${text}`]);
    vscode.postMessage({ type: 'sendMessage', text });
    setInput('');
  };

  return (
    <main className="app-shell">
      <header className="header">
        <div className="brand"><span className="brand-mark">T</span><span>Tulvez Code</span></div>
        <div className="context">{workspaceName}</div>
        <button className="icon-button" type="button" aria-label="Ayarlar">⚙</button>
      </header>
      <section className="content">
        <div className="welcome-card">
          <p className="eyebrow">Geliştirici çalışma alanı</p>
          <h1>Daha anlaşılır kod yazın.</h1>
          <p className="muted">Tulvez Code, geliştirme akışınıza bağlanmaya hazır.</p>
        </div>
        <div className="analysis-grid">
          <article className="card"><span className="card-label">Çalışma alanı</span><strong>Analize hazır</strong><span className="muted">Dosyalar ve bağlam yerel kalır.</span></article>
          <article className="card"><span className="card-label">Git değişiklikleri</span><strong>İlk tarama bekleniyor</strong><span className="muted">Çalışma ağacınızı inceleyin.</span></article>
        </div>
        <div className="messages" aria-live="polite">
          {messages.map((message, index) => <p key={`${message}-${index}`} className="message">{message}</p>)}
        </div>
      </section>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Tulvez Code'a bir şey sorun..." aria-label="Tulvez Code mesajı" />
        <button type="submit">Gönder</button>
      </form>
    </main>
  );
}
