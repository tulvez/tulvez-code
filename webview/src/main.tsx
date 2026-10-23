import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { vscode } from './services/vscode';

// Webview'daki yakalanmamış hatalar eklentiye iletilir; geliştirme kipinde
// .tulvez-dev.log dosyasına yazılır (yayımlanan eklentide yok sayılır).
const report = (text: string) => {
  try { vscode.postMessage({ type: 'clientLog', level: 'error', text }); } catch { /* yoksay */ }
};
window.addEventListener('error', (e) => report(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => report(`promise: ${String((e.reason as Error)?.stack ?? e.reason)}`));

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
