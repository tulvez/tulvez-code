import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { SettingsPage } from './components/SettingsPage';
import { DEFAULT_MODEL, ModelMenu } from './components/ModelMenu';
import { TulvezMark } from './components/TulvezMark';
import { EarthGlobe } from './components/EarthGlobe';
import { prettyModel } from './lib/modelName';
import { chatTitle, chatToMarkdown } from './lib/chatMarkdown';
import { vscode } from './services/vscode';
import type { HostToWebviewMessage, TulvezSettings } from './types';
import {
  ArrowDown, ArrowUp, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy,
  FolderOpen, GitCommit, Hammer, Lightbulb, MessageSquare, RotateCcw, Save, Search, Settings,
  Square, SquarePen, Terminal, Trash2, X, Zap,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';

// Bunun altında arayüz sığmaz; yalnız "paneli genişlet" ekranı gösterilir (ayrı uyarı şeridi yok).
const MIN_WIDTH = 220;
// Kenar çubuğunda başlık ve düğmeler VS Code'un kendi başlık çubuğundadır;
// ayrı editör sekmesinde (Paneli Aç) küçük bir araç çubuğu gösterilir.
const IN_SIDEBAR = document.body.dataset.host !== 'panel';

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

const MODES: { id: AgentMode; label: string; sublabel: string; icon: ReactNode; color: string; placeholder: string }[] = [
  { id: 'ask',   label: 'Ask',   sublabel: 'Okur ve açıklar, dosyaya dokunmaz', icon: <MessageSquare size={13} />, color: 'var(--mode-ask)',   placeholder: "Tulvez Code'a sorun..." },
  { id: 'plan',  label: 'Plan',  sublabel: 'Adım adım plan çıkarır',            icon: <Lightbulb size={13} />,     color: 'var(--mode-plan)',  placeholder: 'Tulvez Code ile planlayın...' },
  { id: 'build', label: 'Build', sublabel: 'Dosyaları düzenler, araç kullanır', icon: <Hammer size={13} />,        color: 'var(--mode-build)', placeholder: 'Tulvez Code ile inşa edin...' },
];

const SLASH_COMMANDS = [
  { cmd: '/run',     hint: 'Terminal komutu çalıştır' },
  { cmd: '/review',  hint: 'Kod incelemesi yap' },
  { cmd: '/commit',  hint: 'Commit mesajı oluştur' },
  { cmd: '/diff',    hint: 'Git değişikliklerini göster' },
  { cmd: '/explain', hint: 'Seçili kodu açıkla' },
  { cmd: '/skill',   hint: 'code_skills.md içindeki bir skill çalıştır' },
];

// Akan yanıt parçaları bu aralıkla toplanıp tek seferde çizilir.
const STREAM_FLUSH_MS = 48;

function formatCost(usd: number): string {
  if (usd === 0) return 'ücretsiz';
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`;
  return n.toLocaleString('tr-TR');
}

// C:\Users\dev\projeler\tulvez-code → projeler/tulvez-code
function shortPath(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/');
}

function dayGroup(ts: number): string {
  const start = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const diff = Math.round((start(new Date()) - start(new Date(ts))) / 86400000);
  if (diff <= 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  if (diff < 7) return 'Bu hafta';
  return 'Daha eski';
}

// Boş sohbetin arka planı: sabit tohumlu yıldız alanı + arada bir kayan yıldız.
// Konumlar her açılışta aynıdır (rastgele ama deterministik); yeniden çizimde zıplamaz.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Eski/zayıf donanım: daha az yıldız, tek kayan yıldız. (Hareket türleri zaten yalnız
// transform/opacity: ekran kartı birleştirir, her karede yeniden boyama yapılmaz.)
const LOW_POWER = (navigator.hardwareConcurrency || 2) <= 4
  || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

// Üç derinlik katmanı: uzaktakiler küçük, sönük ve yavaş; yakındakiler büyük ve hızlı süzülür.
const STAR_LAYERS = [
  { count: 70, sizes: [1, 1, 1.2], alpha: [0.2, 0.5], twinkle: 0.35, drift: 'far' },
  { count: 40, sizes: [1.2, 1.5, 1.8], alpha: [0.35, 0.75], twinkle: 0.5, drift: 'mid' },
  { count: 14, sizes: [2, 2.4, 2.8], alpha: [0.6, 0.95], twinkle: 0.7, drift: 'near' },
].map((layer, li) => {
  const rnd = seeded(20261023 + li * 7919);
  return {
    drift: layer.drift,
    stars: Array.from({ length: LOW_POWER ? Math.ceil(layer.count / 2) : layer.count }, () => ({
      x: rnd() * 100,
      // katman süzülürken boşluk açılmasın diye alan biraz taşar
      y: -10 + rnd() * 120,
      size: layer.sizes[Math.floor(rnd() * layer.sizes.length)],
      alpha: layer.alpha[0] + rnd() * (layer.alpha[1] - layer.alpha[0]),
      twinkle: rnd() < layer.twinkle,
      dur: 2.5 + rnd() * 4,
      delay: rnd() * 6,
    })),
  };
});

function ShootingStar({ first, gap }: { first: number; gap: [number, number] }) {
  const [shot, setShot] = useState(() => ({ x: 40 + Math.random() * 55, y: Math.random() * 40, angle: 150 + Math.random() * 25, wait: first, n: 0 }));
  // Her geçişten sonra başka bir yerden, başka bir açıyla ve rastgele bir aradan sonra doğar
  const next = () => {
    const r = Math.random;
    setShot((p) => ({
      x: 25 + r() * 75, y: r() * 45, angle: 145 + r() * 35,
      wait: gap[0] + r() * (gap[1] - gap[0]), n: p.n + 1,
    }));
  };
  return (
    <span key={shot.n} className="tz-shooting"
      style={{ left: `${shot.x}%`, top: `${shot.y}%`, animationDelay: `${shot.wait}s`, '--a': `${shot.angle}deg` } as CSSProperties}
      onAnimationEnd={next} />
  );
}

// Uzun süre boş ekranda kalınca Dünya yörüngede geçer: ilki ~20 sn sonra,
// sonra 1,5–3 dakikada bir. Geçiş 45 sn sürer; küre kendi ekseninde döner.
function Earth({ active }: { active: boolean }) {
  const [pass, setPass] = useState({ n: 0, wait: 20, low: Math.random() < 0.5 });
  // Küre yalnız ekrandan geçerken çizilir (bekleme süresinde ve gizliyken çizim yok)
  const [flying, setFlying] = useState(false);
  return (
    <div key={pass.n} className={`tz-earth-orbit ${pass.low ? 'is-low' : ''}`}
      style={{ animationDelay: `${pass.wait}s` }}
      onAnimationStart={(e) => { if (e.target === e.currentTarget) setFlying(true); }}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        setFlying(false);
        setPass((p) => ({ n: p.n + 1, wait: 90 + Math.random() * 90, low: !p.low }));
      }}>
      <EarthGlobe size={LOW_POWER ? 104 : 124} running={flying && active} lowPower={LOW_POWER} />
    </div>
  );
}

// Kelime kelime belirme (skiper70 "text reveal" fikri; kaydırma yerine açılışta, yalnız CSS)
function WordReveal({ text, start = 0, step = 0.06 }: { text: string; start?: number; step?: number }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span key={i} className="tz-word" style={{ animationDelay: `${start + i * step}s` }}>{w}{' '}</span>
      ))}
    </>
  );
}

// Uzay yalnız boş sohbette bağlıdır; başka sayfaya geçince tamamen kaldırılır
// (panel görünmezken animasyonlar duraklatılır).
const Starfield = memo(function Starfield() {
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <div className={`tz-space ${hidden ? 'is-paused' : ''} ${LOW_POWER ? 'is-low-power' : ''}`} aria-hidden>
      <Earth active={!hidden} />
      {STAR_LAYERS.map((layer) => (
        <div key={layer.drift} className={`tz-stars tz-drift-${layer.drift}`}>
          {layer.stars.map((s, i) => (
            <span key={i} className={`tz-star ${s.twinkle ? 'is-twinkle' : ''}`}
              style={{
                left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size,
                opacity: s.alpha, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s`,
              }} />
          ))}
        </div>
      ))}
      <ShootingStar first={1.2} gap={[2.5, 6]} />
      {!LOW_POWER && <ShootingStar first={4.5} gap={[4, 9]} />}
    </div>
  );
});

function TooNarrow() {
  return (
    <div className="tz-narrow" role="status">
      <TulvezMark size={22} />
      <p className="tz-narrow-title">Tulvez Code buraya sığmıyor</p>
      <p>Paneli kenarından sürükleyip genişlet.</p>
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

function AiHead({ mode }: { mode: AgentMode }) {
  const m = MODES.find((x) => x.id === mode) ?? MODES[2];
  return (
    <div className="tz-ai-head">
      <span className="tz-ai-mark" />
      <span className="tz-ai-name">Tulvez</span>
      <span className="tz-ai-mode">{m.label.toUpperCase()}</span>
    </div>
  );
}

function AssistantBody({ msg, copied, animate, live, showThinking, onCopy, onAnimationEnd }: {
  msg: ChatMessage; copied: boolean; animate: boolean; live: boolean; showThinking: boolean;
  onCopy: (msg: ChatMessage) => void; onAnimationEnd: (id: number) => void;
}) {
  const { text, inputTokens, outputTokens, costUsd, model, stopped, reasoning } = msg;
  const { displayed, done } = useTyping(text, animate);
  const busy = live && !text.trim() && !stopped;
  const hasUsage = done && inputTokens !== undefined && outputTokens !== undefined && costUsd !== undefined;

  useEffect(() => {
    if (done && animate) onAnimationEnd(msg.id);
  }, [done, animate, onAnimationEnd, msg.id]);

  return (
    <>
      {reasoning && reasoning.trim() && showThinking && (
        <details className="tz-reasoning" open={busy || undefined}>
          <summary>
            <Brain size={12} />
            <span>Düşünüş</span>
            <span className="tz-reasoning-count">{reasoning.length.toLocaleString('tr-TR')} karakter</span>
            <ChevronRight size={12} className="tz-fold-icon" />
          </summary>
          <div className="tz-reasoning-body">{reasoning}</div>
        </details>
      )}
      {(displayed || busy) && (
        <div className="tz-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayed}</ReactMarkdown>
          {busy && <span className="tz-thinking-text">Düşünüyor…</span>}
        </div>
      )}
      {stopped && <div className="tz-stopped">Yanıt durduruldu</div>}
      {done && !busy && !live && (
        <div className="tz-ai-foot">
          <button className="tz-ghost-icon" type="button" title={copied ? 'Kopyalandı' : 'Kopyala'} onClick={() => onCopy(msg)}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {hasUsage && (
            <span className="tz-usage">
              <span>{formatTokens(inputTokens + outputTokens)} token</span>
              <span className="tz-dot-sep" />
              <span>{formatCost(costUsd)}</span>
              {model && (
                <>
                  <span className="tz-dot-sep" />
                  <span className="tz-usage-model" title={model}>{prettyModel(model)}</span>
                </>
              )}
            </span>
          )}
        </div>
      )}
    </>
  );
}

// Tek mesaj. memo: akış sırasında yalnız değişen (akan) mesaj yeniden çizilir;
// uzun sohbetlerde kaydırmanın takılmasının asıl nedeni her parçada bütün
// mesajların markdown'ının yeniden işlenmesiydi.
const MessageItem = memo(function MessageItem({ msg, copied, animate, live, showThinking, onCopy, onRetry, onAnimationEnd }: {
  msg: ChatMessage; copied: boolean; animate: boolean; live: boolean; showThinking: boolean;
  onCopy: (msg: ChatMessage) => void; onRetry: () => void; onAnimationEnd: (id: number) => void;
}) {
  if (msg.role === 'command') {
    const failed = (msg.exitCode ?? 0) !== 0;
    return (
      <div className="tz-turn">
        <div className={`tz-term ${failed ? 'is-failed' : ''}`}>
          <div className="tz-term-head">
            <Terminal size={12} />
            <span>terminal</span>
            <span className={`tz-term-exit ${failed ? 'is-failed' : ''}`}>
              {failed ? `exit ${msg.exitCode}` : 'tamam'}
            </span>
          </div>
          <pre className="tz-term-body">{msg.text}</pre>
        </div>
      </div>
    );
  }
  if (msg.role === 'tool') {
    return (
      <details className="tz-turn tz-tool">
        <summary>
          <span className="tz-tool-icon"><Zap size={11} /></span>
          <span className="tz-tool-name">{msg.toolName ?? 'araç'}</span>
          <span className="tz-tool-hint">{msg.text.slice(0, 90)}</span>
          <ChevronRight size={12} className="tz-fold-icon" />
        </summary>
        <pre className="tz-tool-body">{msg.text}</pre>
      </details>
    );
  }
  if (msg.role === 'user') {
    return (
      <div className="tz-turn tz-turn-user">
        <div className="tz-user-bubble">{msg.text}</div>
      </div>
    );
  }
  const m = msg.mode ?? 'build';
  const style = { '--m-color': `var(--mode-${m})` } as CSSProperties;
  if (msg.text.startsWith('❌')) {
    return (
      <div className="tz-turn tz-turn-ai" style={style}>
        <AiHead mode={m} />
        <div className="tz-error">
          <p>{msg.text.replace(/^❌\s*/, '')}</p>
          <button className="tz-btn tz-btn-ghost tz-btn-sm" type="button" onClick={onRetry}>
            <RotateCcw size={12} /> Tekrar dene
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tz-turn tz-turn-ai" style={style}>
      <AiHead mode={m} />
      <AssistantBody msg={msg} copied={copied} animate={animate} live={live}
        showThinking={showThinking} onCopy={onCopy} onAnimationEnd={onAnimationEnd} />
    </div>
  );
});

export function App(): JSX.Element {
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [input, setInput] = useState('');
  const [model, setModelState] = useState<string>(() => {
    try {
      return localStorage.getItem('tulvez.model') ?? DEFAULT_MODEL;
    } catch {
      return DEFAULT_MODEL;
    }
  });

  // Model seçimi kalıcıdır: ayarlara girip çıkınca veya yeniden açılınca korunur.
  const setModel = (value: string): void => {
    setModelState(value);
    try {
      if (value === DEFAULT_MODEL) localStorage.removeItem('tulvez.model');
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
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [runConfirm, setRunConfirm] = useState<RunConfirm | null>(null);
  const [toolApproval, setToolApproval] = useState<{ id: string; tool: string; args: string } | null>(null);
  const [page, setPage] = useState<Page>('chat');
  const [slashOpen, setSlashOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [commitCard, setCommitCard] = useState<{ text: string; staged: boolean } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem('tulvez.sessions');
      return raw ? (JSON.parse(raw) as ChatSession[]) : [];
    } catch { return []; }
  });
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<TulvezSettings | null>(null);
  const [setupProvider, setSetupProvider] = useState<TulvezSettings['aiProvider']>('gemini');
  const [setupKey, setSetupKey] = useState('');
  const [setupStep, setSetupStep] = useState(0);
  const [setupModel, setSetupModel] = useState('');
  const [setupBaseUrl, setSetupBaseUrl] = useState('');
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [showJump, setShowJump] = useState(false);

  // Sohbet kalıcılığı: akış sırasında her parçada değil, kısa bir gecikmeyle yazılır.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem('tulvez.current', JSON.stringify({
          messages: messages.map((m) => ({ ...m, animated: false })),
          mode,
          sid: sessionIdRef.current,
        }));
      } catch { /* kota */ }
      // Açık sohbet geçmişe de hemen yazılır: hatayla biten ya da yeni sohbet
      // açılmadan kapatılan sohbetler de listede görünür.
      saveCurrentSession(messages);
    }, 400);
    return () => window.clearTimeout(t);
  }, [messages, mode]);

  useEffect(() => {
    try { localStorage.setItem('tulvez.sessions', JSON.stringify(sessions.slice(0, 20))); } catch { /* quota */ }
  }, [sessions]);

  // Yeniden yüklemede aynı oturum sürer; eskiden hep 1'den başlayıp eski kaydın üstüne yazabiliyordu.
  const sessionIdRef = useRef<number>((() => {
    try {
      const sid = (JSON.parse(localStorage.getItem('tulvez.current') ?? '{}') as { sid?: unknown }).sid;
      return typeof sid === 'number' && Number.isFinite(sid) ? sid : Date.now();
    } catch { return Date.now(); }
  })());
  const pendingRun = useRef<string | null>(null);
  const nextId = useRef(1);
  const streamingIdRef = useRef<number | null>(null);
  const animatedIdsRef = useRef<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<AgentMode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // ── Akış tamponu ────────────────────────────────────────────────
  const pendingText = useRef('');
  const pendingReasoning = useRef('');
  const flushTimer = useRef<number | null>(null);

  const flushStream = useCallback(() => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const t = pendingText.current;
    const r = pendingReasoning.current;
    if (!t && !r) return;
    pendingText.current = '';
    pendingReasoning.current = '';
    setWaiting(false);
    const sid = streamingIdRef.current;
    if (sid === null) {
      const id = nextId.current++;
      streamingIdRef.current = id;
      setMessages((prev) => [...prev, {
        id, role: 'assistant', text: t, reasoning: r || undefined, mode: modeRef.current, animated: true,
      }]);
    } else {
      setMessages((prev) => prev.map((m) => (m.id === sid
        ? { ...m, text: m.text + t, reasoning: r ? (m.reasoning ?? '') + r : m.reasoning }
        : m)));
    }
  }, []);

  const queueFlush = useCallback(() => {
    if (flushTimer.current === null) flushTimer.current = window.setTimeout(flushStream, STREAM_FLUSH_MS);
  }, [flushStream]);

  // ── Kaydırma ─────────────────────────────────────────────────────
  // follow: kullanıcı en alttaysa yeni içerik geldikçe alta yapışık kal.
  // Yukarı kaydırma (tekerlek ya da çubuk) takibi bırakır; alta inmek geri açar.
  // İçerik büyümesi ResizeObserver ile izlenir; anlık (smooth olmayan) kaydırılır.
  const followRef = useRef(true);
  const lastTopRef = useRef(0);
  const showJumpRef = useRef(false);

  const setJump = useCallback((v: boolean) => {
    if (showJumpRef.current === v) return;
    showJumpRef.current = v;
    setShowJump(v);
  }, []);

  const snapToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  }, []);

  useEffect(() => {
    if (page !== 'chat') return;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    const onScroll = (): void => {
      const top = el.scrollTop;
      const distance = el.scrollHeight - top - el.clientHeight;
      if (distance < 40) followRef.current = true;
      else if (top < lastTopRef.current - 2) followRef.current = false;
      lastTopRef.current = top;
      setJump(!followRef.current && distance > 160);
    };
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY < 0) followRef.current = false;
    };
    const onResize = (): void => {
      if (followRef.current) snapToBottom();
      else onScroll();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    const ro = new ResizeObserver(onResize);
    ro.observe(content);
    ro.observe(el);
    // Sohbete geri dönüldüğünde (geçmiş/ayarlar sonrası) konumu tazele
    if (followRef.current) snapToBottom();
    onScroll();
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [page, width < MIN_WIDTH, setJump, snapToBottom]);

  const followNow = useCallback(() => {
    followRef.current = true;
    setJump(false);
    requestAnimationFrame(snapToBottom);
  }, [setJump, snapToBottom]);

  const jumpToBottom = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = true;
    setJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // ── Oturum işlemleri ─────────────────────────────────────────────
  const saveCurrentSession = (msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    const first = msgs.find((m) => m.role === 'user') ?? msgs.find((m) => m.text.startsWith('❌'));
    const title = first?.text.replace(/^❌\s*/, '').trim().slice(0, 40) || 'Sohbet';
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
    setPage('chat');
    followRef.current = true;
    setTimeout(() => textareaRef.current?.focus(), 60);
  };

  const deleteSession = (id: number) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (sessionIdRef.current === id) {
      sessionIdRef.current = Date.now();
      setMessages([]);
    }
  };

  // VS Code başlık çubuğu düğmeleri tek seferlik dinleyiciden çağrılır;
  // güncel işlevlere ref üzerinden ulaşılır.
  // Açık sohbeti Markdown olarak eklentiye verir; eklenti adıyla kaydedip VS Code'da açar.
  const exportChat = () => {
    flushStream();
    const msgs = messagesRef.current;
    if (msgs.length === 0) {
      // Boş sohbet: eklenti "kaydedilecek sohbet yok" bilgisini gösterir
      vscode.postMessage({ type: 'exportChat', title: '', markdown: '' });
      return;
    }
    vscode.postMessage({
      type: 'exportChat',
      title: chatTitle(msgs),
      markdown: chatToMarkdown(msgs, { workspace: workspaceName }),
    });
  };

  const navRef = useRef({ newChat, exportChat });
  navRef.current = { newChat, exportChat };

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      if (msg.type === 'initialized') {
        setWorkspaceName(msg.workspaceName);
        setWorkspacePath(msg.workspacePath ?? '');
      } else if (msg.type === 'navigate') {
        if (msg.to === 'newChat') navRef.current.newChat();
        else if (msg.to === 'export') navRef.current.exportChat();
        // Her basışta ilgili sayfayı açar (aç/kapa değil): ikinci basış "açılmadı" gibi görünüyordu
        else if (msg.to === 'history') setPage('history');
        else setPage('settings');
      } else if (msg.type === 'settingsData') {
        setHasApiKey(msg.settings.aiProvider === 'ollama' || !!msg.settings.apiKey);
        setSettings(msg.settings);
        if (msg.settings.aiProvider === 'ollama' || msg.settings.apiKey) {
          vscode.postMessage({ type: 'listModels' });
        }
      } else if (msg.type === 'assistantReasoning') {
        pendingReasoning.current += msg.text;
        queueFlush();
      } else if (msg.type === 'assistantChunk') {
        pendingText.current += msg.text;
        queueFlush();
      } else if (msg.type === 'modelsList') {
        setLiveModels(msg.models);
      } else if (msg.type === 'assistantDone') {
        flushStream();
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
        flushStream();
        setWaiting(false);
        setStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'assistant',
          text: `❌ ${msg.message}`, mode: modeRef.current, animated: false,
        }]);
      } else if (msg.type === 'commandResult') {
        flushStream();
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'command',
          text: msg.output || '(çıktı yok)', exitCode: msg.exitCode,
        }]);
      } else if (msg.type === 'cancelled') {
        flushStream();
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
        flushStream();
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'tool', text: msg.text, toolName: 'tulvez',
        }]);
      } else if (msg.type === 'toolCall') {
        flushStream();
        setMessages((prev) => [...prev, {
          id: nextId.current++, role: 'tool', text: msg.summary, toolName: msg.tool,
        }]);
      } else if (msg.type === 'toolRequest') {
        setToolApproval({ id: msg.id, tool: msg.tool, args: msg.args });
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => {
      window.removeEventListener('message', handler);
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    };
  }, [flushStream, queueFlush]);

  // Kopyalama: seçim kapalı bir bölümü (düşünüş, araç ayrıntısı) kapsıyorsa onun
  // içeriği de kopyalanır. Tarayıcı kapalı <details> içini seçime katmaz; seçimin
  // kopyası ekran dışında açık hâliyle çizilip metni alınır.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent): void => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !e.clipboardData) return;
      const range = sel.getRangeAt(0);
      const closed = [...document.querySelectorAll('details:not([open])')].some((d) => range.intersectsNode(d));
      // Panoya yalnız düz metin gider: tarayıcının eklediği HTML kopyası balon
      // çerçevelerini taşır, zengin metin alan yerlerde "──" çizgisine dönüşüyordu.
      if (!closed) {
        e.clipboardData.setData('text/plain', sel.toString());
        e.preventDefault();
        return;
      }
      const box = document.createElement('div');
      box.className = 'tz-copy-box';
      box.appendChild(range.cloneContents());
      box.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
      // Düşünüş başlığındaki karakter sayısı kopyada gereksiz
      // araç satırındaki kısa özet, açılan ayrıntıda zaten tam hâliyle var
      box.querySelectorAll('.tz-reasoning-count, .tz-fold-icon, .tz-tool-hint').forEach((n) => n.remove());
      document.body.appendChild(box);
      const text = box.innerText.replace(/\n{3,}/g, '\n\n').trim();
      box.remove();
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? window.innerWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    setSlashOpen(val === '/');
    if (val !== '/' && slashOpen) setSlashOpen(false);
  };

  const resetInput = () => {
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const lastPromptRef = useRef<{ text: string; mode: AgentMode; model?: string } | null>(null);

  const historyFor = (msgs: ChatMessage[]) => msgs
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim() && !m.text.startsWith('❌'))
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }))
    .slice(-20);

  const pushUser = (text: string) => {
    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
    followNow();
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setSlashOpen(false);

    const slashMatch = /^\/(commit|review|diff|explain)\s*$/i.exec(text);
    if (slashMatch) {
      pushUser(text);
      vscode.postMessage({ type: 'slash', name: slashMatch[1].toLowerCase() as 'commit' | 'review' | 'diff' | 'explain', mode });
      setWaiting(true);
      setStreaming(true);
      resetInput();
      return;
    }

    const skillMatch = /^\/skill\s+(.+)$/i.exec(text);
    if (skillMatch) {
      pushUser(text);
      vscode.postMessage({ type: 'slash', name: 'skill', arg: skillMatch[1].trim(), mode });
      setWaiting(true);
      setStreaming(true);
      resetInput();
      return;
    }

    const runMatch = /^\/run\s+(.+)$/i.exec(text);
    if (runMatch) {
      pushUser(text);
      pendingRun.current = runMatch[1];
      setRunConfirm({ command: runMatch[1] });
      resetInput();
      return;
    }

    pushUser(text);
    const chosen = model === DEFAULT_MODEL ? undefined : model;
    lastPromptRef.current = { text, mode, model: chosen };
    vscode.postMessage({ type: 'sendMessage', text, mode, history: historyFor(messages), model: chosen });
    setWaiting(true);
    setStreaming(true);
    resetInput();
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

  const answerTool = (approved: boolean) => {
    if (!toolApproval) return;
    vscode.postMessage({ type: 'toolApproval', id: toolApproval.id, approved });
    setToolApproval(null);
  };

  const copy = useCallback(async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.text);
    setCopiedId(msg.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const retry = useCallback(() => {
    const p = lastPromptRef.current;
    if (!p) return;
    const before = messagesRef.current;
    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text: p.text }]);
    followNow();
    vscode.postMessage({ type: 'sendMessage', text: p.text, mode: p.mode, history: historyFor(before), model: p.model });
    setWaiting(true);
    setStreaming(true);
  }, [followNow]);

  const markAnimated = useCallback((id: number) => { animatedIdsRef.current.add(id); }, []);
  const onCopy = useCallback((m: ChatMessage) => { void copy(m); }, [copy]);

  const restoreSession = (s: ChatSession) => {
    saveCurrentSession(messages);
    sessionIdRef.current = s.id;
    setMessages(s.messages);
    setMode(s.mode);
    followRef.current = true;
    setPage('chat');
  };

  const currentMode = MODES.find((m) => m.id === mode)!;
  const modeStyle = { '--m-color': currentMode.color } as CSSProperties;
  const showThinking = settings?.showThinking ?? true;

  const totalCost = messages.reduce((a, m) => a + (m.costUsd ?? 0), 0);
  const totalTokens = messages.reduce((a, m) => a + (m.inputTokens ?? 0) + (m.outputTokens ?? 0), 0);
  const lastUsage = [...messages].reverse().find((m) => m.inputTokens !== undefined && m.contextWindow);
  const ctxPct = lastUsage?.contextWindow
    ? Math.min(100, Math.round(((lastUsage.inputTokens ?? 0) / lastUsage.contextWindow) * 100))
    : 0;


  const focusInput = () => window.setTimeout(() => textareaRef.current?.focus(), 30);

  // ── Geçmiş ───────────────────────────────────────────────────────
  const renderHistory = () => {
    const q = historyQuery.trim().toLowerCase();
    const list = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
    const groups: { name: string; items: ChatSession[] }[] = [];
    for (const s of list) {
      const name = dayGroup(s.ts);
      const g = groups.find((x) => x.name === name);
      if (g) g.items.push(s); else groups.push({ name, items: [s] });
    }
    return (
      <div className="tz-page">
        <header className="tz-topbar">
          <button className="tz-icon-btn" type="button" title="Sohbete dön" onClick={() => setPage('chat')}>
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <span className="tz-topbar-title">Sohbet geçmişi</span>
          {sessions.length > 0 && <span className="tz-count">{sessions.length}</span>}
        </header>
        {sessions.length > 0 && (
          <div className="tz-history-search">
            <Search size={13} />
            <input type="text" placeholder="Sohbetlerde ara" value={historyQuery} spellCheck={false}
              onChange={(e) => setHistoryQuery(e.target.value)} />
            {historyQuery && (
              <button className="tz-ghost-icon" type="button" title="Temizle" onClick={() => setHistoryQuery('')}>
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <div className="tz-scroll tz-history">
          {sessions.length === 0 ? (
            <div className="tz-blank">
              <Clock size={20} strokeWidth={1.6} />
              <p className="tz-blank-title">Henüz geçmiş yok</p>
              <p className="tz-blank-sub">Yeni sohbete geçtiğinde eskisi burada saklanır.</p>
            </div>
          ) : list.length === 0 ? (
            <div className="tz-blank">
              <Search size={18} strokeWidth={1.6} />
              <p className="tz-blank-sub">"{historyQuery}" ile eşleşen sohbet yok.</p>
            </div>
          ) : groups.map((g) => (
            <section key={g.name} className="tz-history-group">
              <p className="tz-section-label">{g.name}</p>
              {g.items.map((s) => (
                <div key={s.id} className="tz-history-row" style={{ '--m-color': `var(--mode-${s.mode})` } as CSSProperties}>
                  <button type="button" className="tz-history-main" onClick={() => restoreSession(s)}>
                    <span className="tz-history-title">{s.title}</span>
                    <span className="tz-history-meta">
                      <span className="tz-mode-dot" />
                      {MODES.find((m) => m.id === s.mode)?.label} · {s.messages.length} mesaj · {new Date(s.ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                    </span>
                  </button>
                  <button type="button" className="tz-ghost-icon tz-history-del" title="Kalıcı sil" onClick={() => deleteSession(s.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    );
  };

  // ── İlk kurulum ──────────────────────────────────────────────────
  const renderSetup = () => {
    const steps = settings?.showModels ? 3 : 2;
    return (
      <div className="tz-setup">
        <div className="tz-setup-steps" aria-hidden>
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={i <= setupStep ? 'is-on' : ''} />
          ))}
        </div>
        <p className="tz-kicker">Kurulum · {Math.min(setupStep + 1, steps)}/{steps}</p>

        {setupStep === 0 && (
          <>
            <p className="tz-setup-title">Hangi yapay zekâyı kullanacaksın?</p>
            <div className="tz-select">
              <select value={setupProvider}
                onChange={(e) => setSetupProvider(e.target.value as TulvezSettings['aiProvider'])}>
                <option value="gemini">Google Gemini (ücretsiz katman)</option>
                <option value="opencode">OpenCode Zen (kendi bakiyen)</option>
                <option value="custom">Özel (OpenAI uyumlu)</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="groq">Groq (çok hızlı)</option>
                <option value="ollama">Ollama (yerel, anahtarsız)</option>
              </select>
              <ChevronDown size={13} />
            </div>
            <div className="tz-setup-actions">
              <button className="tz-btn tz-btn-primary" type="button" onClick={() => {
                if (setupProvider === 'ollama' && settings) {
                  const next = { ...settings, aiProvider: 'ollama' as const, model: '', apiKey: '', baseUrl: setupBaseUrl || settings.baseUrl };
                  vscode.postMessage({ type: 'saveSettings', settings: next });
                  vscode.postMessage({ type: 'listModels' });
                  setSettings(next);
                }
                setSetupStep(setupProvider === 'ollama' && settings?.showModels ? 2 : 1);
              }}>
                Devam
              </button>
            </div>
          </>
        )}

        {setupStep === 1 && (
          <>
            <p className="tz-setup-title">API anahtarını gir</p>
            <p className="tz-setup-hint">Anahtar yalnızca VS Code SecretStorage'da şifreli saklanır, hiçbir yere gönderilmez.</p>
            <input className="tz-field" type="password" placeholder="API anahtarı" value={setupKey}
              onChange={(e) => setSetupKey(e.target.value)} autoComplete="off" spellCheck={false} />
            {setupProvider === 'custom' && (
              <input className="tz-field" type="text" placeholder="Adres — örn. https://openrouter.ai/api/v1 ya da http://localhost:1234/v1"
                value={setupBaseUrl} onChange={(e) => setSetupBaseUrl(e.target.value)} spellCheck={false} />
            )}
            <div className="tz-setup-actions">
              <button className="tz-btn tz-btn-ghost" type="button" onClick={() => setSetupStep(0)}>Geri</button>
              {setupProvider === 'ollama' ? (
                <button className="tz-btn tz-btn-primary" type="button"
                  onClick={() => { setHasApiKey(true); setSetupStep(0); }}>
                  Hazır
                </button>
              ) : (
                <button className="tz-btn tz-btn-primary" type="button" disabled={!setupKey.trim()}
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
            <p className="tz-setup-title">Model seç</p>
            {liveModels.length === 0 ? (
              <p className="tz-setup-hint">Modeller yükleniyor…</p>
            ) : (
              <div className="tz-setup-models">
                {liveModels.slice(0, 40).map((m) => (
                  <button key={m} type="button" title={m}
                    className={`tz-option ${setupModel === m ? 'is-on' : ''}`}
                    onClick={() => setSetupModel(m)}>
                    <span className="tz-option-radio" />
                    <span className="tz-option-label">{prettyModel(m)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="tz-setup-actions">
              <button className="tz-btn tz-btn-ghost" type="button" onClick={() => setSetupStep(0)}>Geri</button>
              <button className="tz-btn tz-btn-primary" type="button"
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
    );
  };

  // ── Karşılama ────────────────────────────────────────────────────
  const renderWelcome = () => (
    <div className="tz-welcome">
      <h1 className="tz-welcome-brand">
        <TulvezMark size={30} className="tz-welcome-logo" />
        <span>Tulvez Code</span>
      </h1>
      <p className="tz-welcome-title"><WordReveal text="Bugün neyi inşa ediyoruz?" start={0.15} /></p>
      <p className="tz-welcome-sub"><WordReveal text="Kodun hakkında sor, bir plan çıkar ya da doğrudan düzenlet." start={0.45} step={0.035} /></p>
      <p className="tz-kicker tz-welcome-ws" title={workspacePath}>{workspaceName || 'çalışma alanı açık değil'}</p>

      {hasApiKey === false && renderSetup()}

      {!workspacePath && (
        <button className="tz-btn tz-btn-ghost tz-welcome-folder" type="button" onClick={() => vscode.postMessage({ type: 'openFolder' })}>
          <FolderOpen size={14} /> Klasör aç
        </button>
      )}

      <p className="tz-welcome-hint"><kbd>/</kbd> komutlar · <kbd>Shift</kbd>+<kbd>Enter</kbd> yeni satır</p>
    </div>
  );

  // ── Onay kartları ────────────────────────────────────────────────
  const renderDock = () => (
    <>
      {runConfirm && (
        <div className="tz-ask">
          <div className="tz-ask-head">
            <Terminal size={12} />
            <span className="tz-ask-kicker">KOMUT İZNİ</span>
            <button className="tz-ghost-icon" type="button" title="Kapat" onClick={() => setRunConfirm(null)}><X size={12} /></button>
          </div>
          <code className="tz-ask-code">{runConfirm.command}</code>
          <div className="tz-ask-actions">
            <button className="tz-btn tz-btn-primary tz-btn-sm" type="button" onClick={() => approveRun(false)}>
              <Check size={12} /> Çalıştır
            </button>
            <button className="tz-btn tz-btn-ghost tz-btn-sm" type="button" onClick={() => approveRun(true)}>
              Sürekli onayla
            </button>
            <button className="tz-btn tz-btn-quiet tz-btn-sm" type="button" onClick={() => setRunConfirm(null)}>
              İptal
            </button>
          </div>
        </div>
      )}

      {commitCard && (
        <div className="tz-ask">
          <div className="tz-ask-head">
            <GitCommit size={12} />
            <span className="tz-ask-kicker">COMMIT MESAJI{commitCard.staged ? '' : ' · AŞAMALI DEĞİL'}</span>
            <button className="tz-ghost-icon" type="button" title="Kapat" onClick={() => setCommitCard(null)}><X size={12} /></button>
          </div>
          <code className="tz-ask-code tz-ask-code-wrap">{commitCard.text}</code>
          <div className="tz-ask-actions">
            <button className="tz-btn tz-btn-primary tz-btn-sm" type="button"
              onClick={() => {
                vscode.postMessage({ type: 'applyCommit', message: commitCard.text });
                setCommitCard(null);
              }}>
              <Check size={12} /> Commit at
            </button>
            <button className="tz-btn tz-btn-ghost tz-btn-sm" type="button"
              onClick={() => { void navigator.clipboard.writeText(commitCard.text); }}>
              <Copy size={12} /> Kopyala
            </button>
            <button className="tz-btn tz-btn-quiet tz-btn-sm" type="button" onClick={() => setCommitCard(null)}>Kapat</button>
          </div>
        </div>
      )}

      {toolApproval && (
        <div className="tz-ask">
          <div className="tz-ask-head">
            <Zap size={12} />
            <span className="tz-ask-kicker">ARAÇ İZNİ · <b>{toolApproval.tool}</b></span>
            <button className="tz-ghost-icon" type="button" title="Reddet" onClick={() => answerTool(false)}><X size={12} /></button>
          </div>
          <code className="tz-ask-code">{toolApproval.args}</code>
          <div className="tz-ask-actions">
            <button className="tz-btn tz-btn-primary tz-btn-sm" type="button" onClick={() => answerTool(true)}>
              <Check size={12} /> İzin ver
            </button>
            <button className="tz-btn tz-btn-quiet tz-btn-sm" type="button" onClick={() => answerTool(false)}>
              Reddet
            </button>
          </div>
        </div>
      )}
    </>
  );

  // ── Giriş kutusu ─────────────────────────────────────────────────
  const modelLabel = model === DEFAULT_MODEL
    ? (settings?.model ? prettyModel(settings.model) : 'Model')
    : prettyModel(model);

  const renderComposer = () => (
    <div className="tz-composer-area">
      {slashOpen && (
        <div className="tz-slash">
          <p className="tz-section-label">Komutlar</p>
          {SLASH_COMMANDS.map((s) => (
            <button key={s.cmd} type="button" className="tz-slash-item"
              onClick={() => { setInput(s.cmd + ' '); setSlashOpen(false); textareaRef.current?.focus(); }}>
              <span className="tz-slash-cmd">{s.cmd}</span>
              <span className="tz-slash-hint">{s.hint}</span>
            </button>
          ))}
        </div>
      )}

      {/* Yapay zekâ çalışırken kenarda mod renginde bir ışık döner (border-beam benzeri) */}
      <form className={`tz-composer mode-${mode} ${streaming || waiting ? 'is-working' : ''}`} style={modeStyle} onSubmit={(e) => { e.preventDefault(); send(); }}>
        {(streaming || waiting) && <span className="tz-beam" aria-hidden><span /></span>}
        <textarea
          ref={textareaRef}
          className="tz-input"
          value={input}
          placeholder={currentMode.placeholder}
          rows={1}
          onChange={(e) => { handleInputChange(e.target.value); autoResize(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSlashOpen(false);
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <div className="tz-composer-bar">
          <div className="tz-composer-left">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button className="tz-chip tz-chip-mode" type="button" title={currentMode.sublabel}>
                  <span className="tz-mode-dot" />
                  <span>{currentMode.label}</span>
                  <ChevronDown size={11} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="tz-menu tz-menu-modes"
                onCloseAutoFocus={(e) => { e.preventDefault(); focusInput(); }}>
                <p className="tz-menu-label">Mod</p>
                {MODES.map((m) => (
                  <DropdownMenuItem key={m.id}
                    className={`tz-menu-item tz-mode-item ${mode === m.id ? 'is-on' : ''}`}
                    style={{ '--m-color': m.color } as CSSProperties}
                    onSelect={() => setMode(m.id)}>
                    <span className="tz-mode-icon">{m.icon}</span>
                    <span className="tz-mode-text">
                      <span className="tz-mode-name">{m.label}</span>
                      <span className="tz-mode-sub">{m.sublabel}</span>
                    </span>
                    {mode === m.id && <Check size={12} className="tz-menu-check" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <ModelMenu
              value={model}
              models={liveModels}
              onSelect={(m) => { setModel(m); focusInput(); }}
              emptyText="Modeller yüklenmedi — Ayarlar'dan bağlantıyı sına"
              trigger={(
                <button className="tz-chip tz-chip-model" type="button"
                  title={model === DEFAULT_MODEL ? `Varsayılan model${settings?.model ? `: ${settings.model}` : ''}` : model}>
                  <span className="tz-chip-label">{modelLabel}</span>
                  <ChevronDown size={11} />
                </button>
              )}
            />
          </div>
          <div className="tz-composer-right">
            {streaming ? (
              <button className="tz-send tz-send-stop" type="button" title="Durdur" onClick={() => vscode.postMessage({ type: 'cancelStream' })}>
                <Square size={10} strokeWidth={3} fill="currentColor" />
              </button>
            ) : (
              <button className="tz-send" type="submit" title="Gönder (Enter)" disabled={!input.trim()}>
                <ArrowUp size={15} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </form>

      <div className="tz-meta">
        {workspacePath && (
          <span className="tz-meta-path" title={workspacePath}>
            {width < 300 ? shortPath(workspacePath).split('/').pop() : shortPath(workspacePath)}
          </span>
        )}
        {messages.length > 0 && (
          <span className="tz-meta-stats" title={`${totalTokens.toLocaleString('tr-TR')} token · ${formatCost(totalCost)}${lastUsage ? ` · bağlam %${ctxPct}` : ''}`}>
            <span>{formatTokens(totalTokens)} token</span>
            {/* Dar panelde dizin adı öncelikli: maliyet ve bağlam ipucuna (title) geçer */}
            {width >= 300 && <span className="tz-dot-sep" />}
            {width >= 300 && <span>{formatCost(totalCost)}</span>}
            {width >= 300 && lastUsage && (
              <>
                <span className="tz-dot-sep" />
                <span className="tz-ctx" title={`Bağlam penceresinin %${ctxPct}'i dolu`}>
                  <span className="tz-ctx-bar"><span style={{ width: `${ctxPct}%` }} /></span>
                  %{ctxPct}
                </span>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );

  // ── Sohbet ───────────────────────────────────────────────────────
  const renderChat = () => (
    <>
      {!IN_SIDEBAR && (
        <header className="tz-toolbar">
          <button className="tz-icon-btn" type="button" title="Yeni sohbet" onClick={newChat}>
            <SquarePen size={15} strokeWidth={1.9} />
          </button>
          <button className="tz-icon-btn" type="button" title="Sohbeti Markdown olarak kaydet" onClick={exportChat}>
            <Save size={15} strokeWidth={1.9} />
          </button>
          <button className="tz-icon-btn" type="button" title="Geçmiş" onClick={() => setPage('history')}>
            <Clock size={15} strokeWidth={1.9} />
          </button>
          <button className="tz-icon-btn" type="button" title="Ayarlar" onClick={() => setPage('settings')}>
            <Settings size={15} strokeWidth={1.9} />
          </button>
        </header>
      )}

      <div className="tz-chat-wrap">
        {messages.length === 0 && <Starfield />}
        <div ref={scrollRef} className="tz-scroll tz-chat">
          <div ref={contentRef} className="tz-chat-content">
            {messages.length === 0 ? renderWelcome() : (
              <div className="tz-thread">
                {messages.map((msg) => (
                  <MessageItem
                    key={msg.id}
                    msg={msg}
                    copied={copiedId === msg.id}
                    animate={(msg.animated ?? false) && !animatedIdsRef.current.has(msg.id)}
                    live={streaming && streamingIdRef.current === msg.id}
                    showThinking={showThinking}
                    onCopy={onCopy}
                    onRetry={retry}
                    onAnimationEnd={markAnimated}
                  />
                ))}
                {waiting && (
                  <div className="tz-turn tz-turn-ai" style={modeStyle}>
                    <AiHead mode={mode} />
                    <div className="tz-dots"><span /><span /><span /></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {messages.length > 0 && showJump && (
          <button className="tz-jump" type="button" title="En alta git" onClick={jumpToBottom}>
            <ArrowDown size={13} strokeWidth={2.2} />
            {streaming && <span>Yanıt sürüyor</span>}
          </button>
        )}
      </div>

      {(runConfirm || commitCard || toolApproval) && <div className="tz-dock">{renderDock()}</div>}
      {renderComposer()}
    </>
  );

  return (
    <div className="tz-shell" ref={shellRef}>
      {width < MIN_WIDTH ? <TooNarrow /> : page === 'settings' ? (
        <SettingsPage
          onBack={() => setPage('chat')}
          onModelChange={(m) => setModel(m)}
          models={liveModels}
        />
      ) : page === 'history' ? renderHistory() : renderChat()}
    </div>
  );
}
