import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { SettingsPage } from './components/SettingsPage';
import { vscode } from './services/vscode';
import type { HostToWebviewMessage, TulvezSettings } from './types';
import {
  Check, ChevronDown, ChevronLeft, CirclePlus, Clock, Copy, FolderOpen, GitBranch, GitCommit, Hammer,
  MessageSquare, Search, Send, Settings, Sparkles, Square, SquarePen,
  Terminal, Trash2, X, Zap, ChevronRight,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';

const MIN_WIDTH = 220;

type AgentMode = 'ask' | 'plan' | 'build';
type Page = 'chat' | 'settings' | 'history';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'command' | 'tool';
  text: string;
  exitCode?: number;
  mode?: AgentMode;
  animated?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  contextWindow?: number;
  model?: string;
  stopped?: boolean;
  reasoning?: string;
  toolName?: string;
}
interface ChatSession { id: number; title: string; messages: ChatMessage[]; mode: AgentMode; ts: number; }
interface RunConfirm { command: string; }

const MODES: { id: AgentMode; label: string; sublabel: string; icon: React.ReactNode; color: string; placeholder: string }[] = [
  { id: 'ask',   label: 'Ask',   sublabel: "Tulvez Code'a sorun",    icon: <MessageSquare size={12} />, color: 'var(--mode-ask)',   placeholder: "Tulvez Code'a sorun..." },
  { id: 'plan',  label: 'Plan',  sublabel: 'Tulvez Code ile planla',  icon: <Sparkles size={12} />,      color: 'var(--mode-plan)',  placeholder: 'Tulvez Code ile planlayın...' },
  { id: 'build', label: 'Build', sublabel: 'Tulvez Code ile inşa et', icon: <Hammer size={12} />,        color: 'var(--mode-build)', placeholder: 'Tulvez Code ile inşa edin...' },
];

const SLASH_COMMANDS = [
  { cmd: '/run',     hint: 'Terminal komutu çalıştır' },
  { cmd: '/review',  hint: 'Kod incelemesi yap' },
  { cmd: '/commit',  hint: 'Commit mesajı oluştur' },
  { cmd: '/diff',    hint: 'Git değişikliklerini göster' },
  { cmd: '/explain', hint: 'Seçili kodu açıkla' },
  { cmd: '/skill',   hint: 'code_skills.md içindeki bir skill çalıştır' },
];

const QUICK_ACTIONS = [
  { icon: <MessageSquare size={13} />, label: 'Dosyayı açıkla',             prompt: 'Bu dosyayı açıklar mısın?' },
  { icon: <GitBranch size={13} />,     label: 'Git değişikliklerini incele', prompt: 'Git değişikliklerimi incele' },
  { icon: <Terminal size={13} />,      label: 'Komut çalıştır',              prompt: '/run git status' },
  { icon: <Sparkles size={13} />,      label: 'Commit mesajı oluştur',       prompt: 'Commit mesajı oluştur' },
];

const SKILLS = [
  { label: 'Çalışma alanını analiz et',   prompt: 'Çalışma alanımı analiz et' },
  { label: 'Git değişikliklerini incele', prompt: 'Git değişikliklerimi incele' },
  { label: 'Commit mesajı oluştur',       prompt: 'Commit mesajı oluştur' },
  { label: 'Kod incelemesi yap',          prompt: 'Kodumu incele ve geri bildirim ver' },
];

function ModelPicker({ model, models, onSelect }: { model: string; models: string[]; onSelect: (m: string) => void }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = search.trim()
    ? models.filter((m) => m.toLowerCase().includes(search.toLowerCase()))
    : models;
  const displayLabel = model === 'Varsayılan' ? 'Model' : model;

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) { setSearch(''); setTimeout(() => inputRef.current?.focus(), 50); } }}>
      <DropdownMenuTrigger asChild>
        <button className="composer-btn model-btn" type="button" title={model === 'Varsayılan' ? 'Model: varsayılan' : model}>
          <span className="model-btn-label">{displayLabel}</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="dropdown-content model-dropdown">
        <div className="model-search-wrap">
          <Search size={12} className="model-search-icon" />
          <input
            ref={inputRef}
            className="model-search-input"
            type="text"
            placeholder="Ara… (flash, :free, gpt)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="model-list-scroll">
          {['Varsayılan', ...filtered].map((m) => (
            <DropdownMenuItem key={m} className="dropdown-item" onSelect={() => onSelect(m)}>
              <span className="model-item-name" title={m}>{m}</span>
              {model === m && <Check size={11} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
            </DropdownMenuItem>
          ))}
          {filtered.length === 0 && (
            <div className="model-no-result">Eşleşen model yok</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


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
  const [index, setIndex] = useState(full.length);
  const lastFull = useRef(full);

  // Metin gerçekten büyüdüyse (yeni parça geldi) kuyruğu sona çek.
  useEffect(() => {
    const grew = full.length > lastFull.current.length;
    lastFull.current = full;
    if (!full) {
      setIndex(0);
      return;
    }
    if (!active || grew) {
      setIndex(full.length);
      return;
    }
    const near = Math.max(0, full.length - 24);
    setIndex((i) => (i < near ? near : i));
    if (full.length <= 24) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i >= full.length ? i : Math.min(full.length, i + 4)));
    }, speed);
    return () => window.clearInterval(id);
  }, [full, active, speed]);

  return { displayed: full.slice(0, index), done: index >= full.length };
}

function UsageBadge({ inputTokens, outputTokens, costUsd, model }: { inputTokens: number; outputTokens: number; costUsd: number; model?: string }) {
  const total = inputTokens + outputTokens;
  const costStr = costUsd === 0 ? 'ücretsiz' : costUsd < 0.001 ? `$${(costUsd * 1000).toFixed(3)}m` : `$${costUsd.toFixed(4)}`;
  return (
    <div className="usage-badge">
      <span>{total.toLocaleString()} token</span>
      <span className="usage-sep">·</span>
      <span>{costStr}</span>
      {model && (
        <>
          <span className="usage-sep">·</span>
          <span>{model}</span>
        </>
      )}
    </div>
  );
}

function AssistantBubble({ text, onCopy, copied, animate, inputTokens, outputTokens, costUsd, model, stopped, reasoning, showThinking, live, onAnimationEnd }: {
  text: string; onCopy: () => void; copied: boolean; animate: boolean;
  inputTokens?: number; outputTokens?: number; costUsd?: number; model?: string; stopped?: boolean;
  reasoning?: string; showThinking: boolean; live?: boolean; onAnimationEnd?: () => void;
}) {
  const { displayed, done } = useTyping(text, animate);
  const waiting = !!live && !text.trim() && !stopped;
  const busy = waiting || (!!live && !done && !stopped && !text.trim());

  useEffect(() => {
    if (done && animate) onAnimationEnd?.();
  }, [done, animate, onAnimationEnd]);
  return (
    <>
      {reasoning && reasoning.trim() && showThinking && (
        <details className="reasoning" open={busy || undefined}>
          <summary>Düşünüş ({reasoning.length} karakter)</summary>
          <div className="reasoning-body">{reasoning}</div>
        </details>
      )}
      <div className="turn-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayed}</ReactMarkdown>
        {busy && <span className="thinking-inline">Düşünüyor…</span>}
      </div>
      {stopped && <div className="stopped-label">Yanıt durduruldu</div>}
      {done && inputTokens !== undefined && outputTokens !== undefined && costUsd !== undefined && (
        <UsageBadge inputTokens={inputTokens} outputTokens={outputTokens} costUsd={costUsd} model={model} />
      )}
      <div className="turn-actions-always">
        <button className="turn-action-btn" type="button" title="Kopyala" onClick={onCopy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </>
  );
}

export function App(): JSX.Element {
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [logoUri, setLogoUri] = useState('');
  const [input, setInput] = useState('');
  const [model, setModelState] = useState<string>(() => {
    try {
      return localStorage.getItem('tulvez.model') ?? 'Varsayılan';
    } catch {
      return 'Varsayılan';
    }
  });

  // Model seçimi kalıcıdır: ayarlara girip çıkınca veya yeniden açılınca korunur.
  const setModel = (value: string): void => {
    setModelState(value);
    try {
      if (value === 'Varsayılan') localStorage.removeItem('tulvez.model');
      else localStorage.setItem('tulvez.model', value);
    } catch { /* kota */ }
  };
  const [mode, setMode] = useState<AgentMode>(() => {
    try {
      const raw = localStorage.getItem('tulvez.current');
      const m = raw ? (JSON.parse(raw) as { mode?: AgentMode }).mode : undefined;
      return m ?? 'build';
    } catch { return 'build'; }
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = localStorage.getItem('tulvez.current');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { messages?: ChatMessage[] };
      if (!Array.isArray(parsed.messages)) return [];
      // Bozuk kayıtları ele: id'siz, metni olmayan ya da devasa kayıtlar
      return parsed.messages.filter(
        (m): m is ChatMessage =>
          !!m && typeof m === 'object' && typeof m.text === 'string'
          && Number.isFinite(m.id) && m.text.length < 20000,
      );
    } catch { return []; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('tulvez.current', JSON.stringify({
        messages: messages.map((m) => ({ ...m, animated: false })),
        mode,
      }));
    } catch { /* kota */ }
  }, [messages, mode]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [runConfirm, setRunConfirm] = useState<RunConfirm | null>(null);
  const [toolApproval, setToolApproval] = useState<{ id: string; tool: string; args: string } | null>(null);
  const [page, setPage] = useState<Page>('chat');
  const [slashOpen, setSlashOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [commitCard, setCommitCard] = useState<{ text: string; staged: boolean } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem('tulvez.sessions');
      return raw ? (JSON.parse(raw) as ChatSession[]) : [];
    } catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem('tulvez.sessions', JSON.stringify(sessions.slice(0, 20))); } catch { /* quota */ }
  }, [sessions]);

  const deleteSession = (id: number) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (sessionIdRef.current === id) {
      sessionIdRef.current = Date.now();
      setMessages([]);
    }
  };
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [provider, setProvider] = useState('');
  const [settings, setSettings] = useState<TulvezSettings | null>(null);
  const [setupProvider, setSetupProvider] = useState<TulvezSettings['aiProvider']>('gemini');
  const [setupKey, setSetupKey] = useState('');
  const [setupStep, setSetupStep] = useState(0);
  const [setupModel, setSetupModel] = useState('');
  const [setupBaseUrl, setSetupBaseUrl] = useState('');
  const [liveModels, setLiveModels] = useState<string[]>([]);

  const sessionIdRef = useRef(1);
  const pendingRun = useRef<string | null>(null);
  const nextId = useRef(1);
  const streamingIdRef = useRef<number | null>(null);
  const animatedIdsRef = useRef<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // mode'u closure'da güncel tutmak için
  const modeRef = useRef<AgentMode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      if (msg.type === 'initialized') {
        setWorkspaceName(msg.workspaceName);
        setWorkspacePath(msg.workspacePath ?? '');
        setLogoUri(msg.logoUri);
      } else if (msg.type === 'settingsData') {
        setProvider(msg.settings.aiProvider);
        setHasApiKey(msg.settings.aiProvider === 'ollama' || !!msg.settings.apiKey);
        setSettings(msg.settings);
        if (msg.settings.aiProvider === 'ollama' || msg.settings.apiKey) {
          vscode.postMessage({ type: 'listModels' });
        }
      } else if (msg.type === 'assistantReasoning') {
        setWaiting(false);
        setMessages((prev) => {
          const sid = streamingIdRef.current;
          if (sid === null) {
            const id = nextId.current++;
            streamingIdRef.current = id;
            return [...prev, { id, role: 'assistant', text: '', reasoning: msg.text, mode: modeRef.current, animated: true }];
          }
          return prev.map((m) => (m.id === sid ? { ...m, reasoning: (m.reasoning ?? '') + msg.text } : m));
        });
      } else if (msg.type === 'modelsList') {
        setLiveModels(msg.models);
      } else if (msg.type === 'assistantChunk') {
        setWaiting(false);
        if (streamingIdRef.current === null) {
          const id = nextId.current++;
          streamingIdRef.current = id;
          setMessages((prev) => [...prev, { id, role: 'assistant', text: msg.text, mode: modeRef.current, animated: true }]);
        } else {
          const sid = streamingIdRef.current;
          setMessages((prev) => prev.map((m) => m.id === sid ? { ...m, text: m.text + msg.text } : m));
        }
      } else if (msg.type === 'assistantDone') {
        setWaiting(false);
        setStreaming(false);
        const sid = streamingIdRef.current;
        if (sid !== null) {
          setMessages((prev) => prev.map((m) => m.id === sid
            ? { ...m, inputTokens: msg.inputTokens, outputTokens: msg.outputTokens, costUsd: msg.costUsd, contextWindow: msg.contextWindow, model: msg.model }
            : m,
          ));
          streamingIdRef.current = null;
        }
      } else if (msg.type === 'error') {
        setWaiting(false);
        setStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'assistant',
          text: `❌ ${msg.message}`, mode: modeRef.current, animated: false,
        }]);
      } else if (msg.type === 'commandResult') {
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'command',
          text: msg.output || '(çıktı yok)', exitCode: msg.exitCode,
        }]);
      } else if (msg.type === 'cancelled') {
        setWaiting(false);
        setStreaming(false);
        const sid = streamingIdRef.current;
        if (sid !== null) {
          setMessages((prev) => prev.map((m) => (m.id === sid ? { ...m, stopped: true } : m)));
          streamingIdRef.current = null;
        }
      } else if (msg.type === 'commitMessage') {
        setCommitCard({ text: msg.text, staged: msg.staged });
      } else if (msg.type === 'commitResult') {
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'command',
          text: msg.output, exitCode: msg.exitCode,
        }]);
        if (msg.exitCode === 0) setCommitCard(null);
      } else if (msg.type === 'systemNotice') {
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'tool', text: msg.text, toolName: 'tulvez',
        }]);
      } else if (msg.type === 'toolCall') {
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'tool', text: msg.summary, toolName: msg.tool,
        }]);
      } else if (msg.type === 'toolRequest') {
        setToolApproval({ id: msg.id, tool: msg.tool, args: msg.args });
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

  // Scroll: kullanıcı en alttaysa yeni mesajları takip et.
  // Streaming sırasında yukarı kaydırırsa zorla aşağı çekme.
  const [sticky, setSticky] = useState(false);
  const [lastStreamingId, setLastStreamingId] = useState<number | null>(null);
  const stickToBottom = useRef(true);
  const prevStreamingId = useRef<number | null>(null);
  const userScrolledUp = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance < 80;
      stickToBottom.current = atBottom;
      // Kullanıcı yukarı kaydırdıysa streaming sırasında zorla aşağı çekme
      if (!atBottom) userScrolledUp.current = true;
      if (atBottom) userScrolledUp.current = false;
      setSticky(!atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const current = streamingIdRef.current;
    // Kullanıcı yukarı kaydırdıysa streaming sırasında scroll yapma
    if (userScrolledUp.current && current !== null) {
      prevStreamingId.current = current;
      setLastStreamingId(current);
      return;
    }
    if (stickToBottom.current) {
      const continuous = prevStreamingId.current === current;
      el.scrollTo({ top: el.scrollHeight, behavior: continuous ? 'auto' : 'smooth' });
    }
    prevStreamingId.current = current;
    setLastStreamingId(current);
  }, [messages, waiting, runConfirm, toolApproval, commitCard, streaming]);

  // Yeni mesaj gönderilince (streaming başlayınca) scroll kilidi sıfırla
  useEffect(() => {
    if (!streaming) return;
    userScrolledUp.current = false;
    stickToBottom.current = true;
    setSticky(false);
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [streaming]);

  const jumpToBottom = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    setSticky(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

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

    const slashMatch = /^\/(commit|review|diff|explain)\s*$/i.exec(text);
    if (slashMatch) {
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
      vscode.postMessage({ type: 'slash', name: slashMatch[1].toLowerCase() as 'commit' | 'review' | 'diff' | 'explain', mode });
      setWaiting(true);
      setStreaming(true);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    const skillMatch = /^\/skill\s+(.+)$/i.exec(text);
    if (skillMatch) {
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
      vscode.postMessage({ type: 'slash', name: 'skill', arg: skillMatch[1].trim(), mode });
      setWaiting(true);
      setStreaming(true);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

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
    lastPromptRef.current = { text, mode, model: model === 'Varsayılan' ? undefined : model };
    const history = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim() && !m.text.startsWith('❌'))
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }))
      .slice(-20);
    vscode.postMessage({ type: 'sendMessage', text, mode, history, model: model === 'Varsayılan' ? undefined : model });
    setWaiting(true);
    setStreaming(true);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const approveRun = (autoApprove = false) => {
    if (!runConfirm) return;
    if (autoApprove && settings) {
      const next = { ...settings, autoApproveCommands: true, allowShellCommands: true };
      vscode.postMessage({ type: 'saveSettings', settings: next });
      setSettings(next);
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
      const session: ChatSession = {
        id: sessionIdRef.current, title, mode, ts: Date.now(),
        messages: msgs.map((m) => ({ ...m, animated: false })),
      };
      if (existing >= 0) { const next = [...prev]; next[existing] = session; return next; }
      return [session, ...prev];
    });
  };

  const newChat = () => {
    saveCurrentSession(messages);
    sessionIdRef.current = Date.now();
    setMessages([]);
    setRunConfirm(null);
    setWaiting(false);
    setStreaming(false);
  };

  const lastPromptRef = useRef<{ text: string; mode: AgentMode; model?: string } | null>(null);

  const retry = () => {
    const p = lastPromptRef.current;
    if (!p) return;
    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text: p.text }]);
    const history = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim() && !m.text.startsWith('❌'))
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }))
      .slice(-20);
    vscode.postMessage({ type: 'sendMessage', text: p.text, mode: p.mode, history, model: p.model });
    setWaiting(true);
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

  const totalCost = messages.reduce((a, m) => a + (m.costUsd ?? 0), 0);
  const totalTokens = messages.reduce((a, m) => a + (m.inputTokens ?? 0) + (m.outputTokens ?? 0), 0);
  const lastUsage = [...messages].reverse().find((m) => m.inputTokens !== undefined && m.contextWindow);
  const ctxPct = lastUsage?.contextWindow
    ? Math.min(100, Math.round(((lastUsage.inputTokens ?? 0) / lastUsage.contextWindow) * 100))
    : 0;

  return (
    <div className="shell" ref={shellRef}>
      <div className="shell-content">
        {width < MIN_WIDTH ? <TooNarrow /> : page === 'settings' ? (
          <SettingsPage onBack={() => setPage('chat')} onModelChange={(m) => setModel(m)} />
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
                <div key={s.id} className="history-item">
                  <span className={`history-mode-dot mode-dot-${s.mode}`} />
                  <button type="button" className="history-item-main" onClick={() => restoreSession(s)}>
                    <span className="history-item-title">{s.title}</span>
                    <span className="history-item-meta">{s.messages.length} mesaj · {new Date(s.ts).toLocaleDateString('tr-TR')}</span>
                  </button>
                  <button type="button" className="history-delete" title="Kalıcı sil" onClick={() => deleteSession(s.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <header className="header">
              <div className="header-brand">
                {logoUri ? <img src={logoUri} className="brand-logo" alt="Tulvez" /> : <span className="brand-icon">T</span>}
                <span className="brand-name">Tulvez Code</span>
              </div>
              <div className="header-actions">
                <button className="icon-btn" type="button" title="Commit mesajı hazırla"
                  onClick={() => {
                    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text: '/commit' }]);
                    vscode.postMessage({ type: 'slash', name: 'commit', mode });
                    setWaiting(true);
                    setStreaming(true);
                  }}>
                  <GitCommit size={15} strokeWidth={1.8} />
                </button>
                <button className="icon-btn" type="button" title="Klasör aç" onClick={() => vscode.postMessage({ type: 'openFolder' })}>
                  <FolderOpen size={15} strokeWidth={1.8} />
                </button>
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

            <div ref={scrollRef} className="chat-area">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    {logoUri ? <img src={logoUri} className="empty-logo" alt="Tulvez" /> : <Sparkles size={24} strokeWidth={1.6} />}
                  </div>
                  <p className="empty-title">Tulvez Code</p>
                  <p className="empty-subtitle">Kodunuz hakkında soru sorun veya bir işlem seçin.</p>
                  {hasApiKey === false && (
                    <div className="setup-card">
                      <div className="setup-steps">
                        <span className={setupStep === 0 ? 'on' : ''}>1 · Sağlayıcı</span>
                        <span className={setupStep === 1 ? 'on' : ''}>2 · Anahtar</span>
                        {settings?.showModels && <span className={setupStep === 2 ? 'on' : ''}>3 · Model</span>}
                      </div>

                      {setupStep === 0 && (
                        <>
                          <p className="setup-card-title">Hangi yapay zekayı kullanacaksın?</p>
                          <select
                            className="ws-input setup-provider"
                            value={setupProvider}
                            onChange={(e) => setSetupProvider(e.target.value as TulvezSettings['aiProvider'])}
                          >
                            <option value="gemini">Google Gemini (ücretsiz katman)</option>
                            <option value="opencode">OpenCode Zen (kendi bakiyen)</option>
                            <option value="custom">Özel (OpenAI uyumlu)</option>
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="groq">Groq (çok hızlı)</option>
                            <option value="ollama">Ollama (yerel, anahtarsız)</option>
                          </select>
                          <button className="ws-create-btn" type="button" onClick={() => {
                            if (setupProvider === 'ollama' && settings) {
                              const next = { ...settings, aiProvider: 'ollama' as const, model: '', apiKey: '', baseUrl: setupBaseUrl || settings.baseUrl };
                              vscode.postMessage({ type: 'saveSettings', settings: next });
                              vscode.postMessage({ type: 'listModels' });
                              setSettings(next);
                            }
                            setSetupStep(setupProvider === 'ollama' && settings?.showModels ? 2 : (setupProvider === 'ollama' ? 1 : 1));
                          }}>
                            Devam
                          </button>
                        </>
                      )}

                      {setupStep === 1 && (
                        <>
                          <p className="setup-card-title">API anahtarını gir</p>
                          <div className="s-hint">Anahtarın yalnızca VS Code SecretStorage'da şifreli saklanır, hiçbir yere gönderilmez.</div>
                          <input
                            className="ws-input"
                            type="password"
                            placeholder="API anahtarı"
                            value={setupKey}
                            onChange={(e) => setSetupKey(e.target.value)}
                            autoComplete="off"
                          />
                          {setupProvider === 'custom' && (
                            <input
                              className="ws-input"
                              type="text"
                              placeholder="Base URL (örn. https://openrouter.ai/api/v1)"
                              value={setupBaseUrl}
                              onChange={(e) => setSetupBaseUrl(e.target.value)}
                            />
                          )}
                          <div className="setup-row">
                            <button className="ws-create-btn" type="button" style={{ background: 'transparent', border: '1px solid var(--vscode-panel-border)' }}
                              onClick={() => setSetupStep(0)}>Geri</button>
                            {setupProvider === 'ollama' ? (
                              <button className="ws-create-btn" type="button"
                                onClick={() => { setHasApiKey(true); setSetupStep(0); }}>
                                Hazır
                              </button>
                            ) : (
                            <button className="ws-create-btn" type="button" disabled={!setupKey.trim()}
onClick={() => {
                                  if (!settings) return;
                                  const next = {
                                    ...settings, aiProvider: setupProvider, model: '',
                                    apiKey: setupKey.trim(), baseUrl: setupBaseUrl.trim() || settings.baseUrl,
                                  };
                                  vscode.postMessage({ type: 'saveSettings', settings: next });
vscode.postMessage({ type: 'listModels' });
        setSettings(next);
        setHasApiKey(true);
        if (settings.showModels) setSetupStep(2);
                                }}>
                              Kaydet ve devam
                            </button>
                            )}
                          </div>
                        </>
                      )}

                      {setupStep === 2 && (
                        <>
                          <p className="setup-card-title">Model seç</p>
                          {liveModels.length === 0 ? (
                            <div className="s-hint">Modeller yükleniyor…</div>
                          ) : (
                            <div className="setup-model-list">
                              {liveModels.slice(0, 40).map((m) => (
                                <button key={m} type="button"
                                  className={`provider-card ${setupModel === m ? 'active' : ''}`}
                                  onClick={() => setSetupModel(m)}>
                                  <span className="provider-dot" />
                                  <span className="provider-name">{m}</span>
                                  {setupModel === m && <Check size={12} className="provider-check" />}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="setup-row">
                            <button className="ws-create-btn" type="button" style={{ background: 'transparent', border: '1px solid var(--vscode-panel-border)' }}
                              onClick={() => setSetupStep(0)}>Geri</button>
                            <button className="ws-create-btn" type="button"
                              onClick={() => {
                                if (!settings) return;
                                const next = {
                                  ...settings, aiProvider: setupProvider, apiKey: setupKey.trim(),
                                  baseUrl: setupBaseUrl.trim() || settings.baseUrl, model: setupModel,
                                };
                                vscode.postMessage({ type: 'saveSettings', settings: next });
                                setSettings(next);
                                if (setupModel) setModel(setupModel);
                              }}>
                              Hazır
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
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
                    if (msg.role === 'tool') return (
                      <details key={msg.id} className="message-turn command tool-fold">
                        <summary className="command-header">
                          <ChevronRight size={11} />
                          <Zap size={11} />
                          <span>{msg.toolName ?? 'araç'}</span>
                          <span className="tool-fold-hint">{msg.text.slice(0, 70)}</span>
                        </summary>
                        <pre className="command-output">{msg.text}</pre>
                      </details>
                    );
                    return (
                      <div key={msg.id} className={`message-turn ${msg.role}`}>
                        {msg.role === 'assistant' && (
                          <div className="turn-header">
                            <span className={`turn-avatar assistant mode-avatar-${msg.mode ?? 'build'}`}>
                              <Sparkles size={10} strokeWidth={2} />
                            </span>
                          </div>
                        )}
                        {msg.role === 'assistant' && msg.text.startsWith('❌') ? (
                          <div className="turn-body">
                            {msg.text}
                            <div style={{ marginTop: 6 }}>
                              <button className="rcb rcb-always" type="button" onClick={retry}>Tekrar dene</button>
                            </div>
                          </div>
                        ) : msg.role === 'assistant' ? (
                          <AssistantBubble
                            text={msg.text}
                            animate={(msg.animated ?? false) && !animatedIdsRef.current.has(msg.id)}
                            copied={copiedId === msg.id}
                            inputTokens={msg.inputTokens}
                            outputTokens={msg.outputTokens}
                            costUsd={msg.costUsd}
                            model={msg.model}
                            stopped={msg.stopped}
                            reasoning={msg.reasoning}
                            showThinking={settings?.showThinking ?? true}
                            live={streaming && streamingIdRef.current === msg.id}
                            onAnimationEnd={() => animatedIdsRef.current.add(msg.id)}
                            onCopy={() => void copy(msg)}
                          />
                        ) : (
                          <div className="turn-body">{msg.text}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {waiting && (
                <div className="message-turn assistant">
                  <div className="turn-header">
                    <span className={`turn-avatar assistant mode-avatar-${mode}`}>
                      <Sparkles size={10} strokeWidth={2} />
                    </span>
                    <span className="thinking-label">Tulvez Code · {MODES.find((m) => m.id === mode)?.label} modu</span>
                  </div>
                  <div className="turn-body thinking-dots">
                    <span /><span /><span />
                  </div>
                </div>
              )}
            {messages.length > 0 && sticky && (
              <button className="jump-bottom" type="button" title="En alta git" onClick={jumpToBottom}>
                <ChevronDown size={14} />
                {streaming && <span>Yanıt devam ediyor</span>}
              </button>
            )}
            </div>

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

            {commitCard && (
              <div className="commit-card">
                <div className="commit-card-head">
                  <GitCommit size={12} />
                  <span>Commit mesajı{commitCard.staged ? '' : ' (aşamalı değil)'}</span>
                  <button className="run-confirm-close" type="button" onClick={() => setCommitCard(null)}><X size={11} /></button>
                </div>
                <code className="commit-card-msg">{commitCard.text}</code>
                <div className="run-confirm-actions">
                  <button className="rcb rcb-approve" type="button"
                    onClick={() => {
                      vscode.postMessage({ type: 'applyCommit', message: commitCard.text });
                      setCommitCard(null);
                    }}>
                    <Check size={11} /> Commit at
                  </button>
                  <button className="rcb rcb-always" type="button"
                    onClick={() => { void navigator.clipboard.writeText(commitCard.text); }}>
                    Kopyala
                  </button>
                  <button className="rcb rcb-deny" type="button" onClick={() => setCommitCard(null)}>Kapat</button>
                </div>
              </div>
            )}

            {toolApproval && (
              <div className="run-confirm-bar">
                <div className="run-confirm-bar-top">
                  <Zap size={11} /><span>Araç izni isteği: {toolApproval.tool}</span>
                  <button className="run-confirm-close" type="button" onClick={() => { vscode.postMessage({ type: 'toolApproval', id: toolApproval.id, approved: false }); setToolApproval(null); }}><X size={11} /></button>
                </div>
                <code className="run-confirm-cmd">{toolApproval.args}</code>
                <div className="run-confirm-actions">
                  <button className="rcb rcb-approve" type="button" onClick={() => { vscode.postMessage({ type: 'toolApproval', id: toolApproval.id, approved: true }); setToolApproval(null); }}>
                    <Check size={11} /> Onayla
                  </button>
                  <button className="rcb rcb-deny" type="button" onClick={() => { vscode.postMessage({ type: 'toolApproval', id: toolApproval.id, approved: false }); setToolApproval(null); }}>
                    Reddet
                  </button>
                </div>
              </div>
            )}

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

            {messages.length > 0 && (
              <div className="stats-bar">
                <span>{totalTokens.toLocaleString('tr-TR')} token</span>
                <span className="stats-sep">·</span>
                <span>{totalCost === 0 ? 'ücretsiz' : totalCost < 0.001 ? `$${(totalCost * 1000).toFixed(3)}m` : `$${totalCost.toFixed(4)}`}</span>
                {lastUsage && (
                  <>
                    <span className="stats-sep">·</span>
                    <span>Bağlam %{ctxPct}</span>
                  </>
                )}
              </div>
            )}

            <div className="composer-wrap">
              <div className="mode-bar">
                {workspacePath && <span className="mode-ws" title={workspacePath}>{workspacePath}</span>}
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
                      <DropdownMenuItem key={m.id}
                        className={`dropdown-item mode-item-${m.id} ${mode === m.id ? 'mode-item-active' : ''}`}
                        onSelect={() => { setMode(m.id); window.setTimeout(() => textareaRef.current?.focus(), 50); }}>
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
              <form className={modeClass} style={{ '--m-color': currentMode.color } as React.CSSProperties} onSubmit={(e) => { e.preventDefault(); send(); }}>
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
<ModelPicker
                      model={model}
                      models={liveModels}
                      onSelect={setModel}
                    />
                  </div>
                  <div className="composer-right">
                    {streaming ? (
                      <button className="send-btn stop-btn" type="button" title="Durdur" onClick={() => vscode.postMessage({ type: 'cancelStream' })}>
                        <Square size={11} strokeWidth={2.5} />
                      </button>
                    ) : (
                      <button className={`send-btn send-btn-${mode}`} type="submit" title="Gönder" disabled={!input.trim()}>
                        <Send size={13} strokeWidth={2} />
                      </button>
                    )}
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

