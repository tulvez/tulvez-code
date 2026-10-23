// Sağlayıcının ham model kimliğini kısa, okunur bir ada çevirir.
//   anthropic/claude-opus-5-5-20260101   → Opus 5.5
//   deepseek/deepseek-v4.1-flash:free    → DeepSeek v4.1 Flash
//   models/gemini-3.1-flash-preview      → Gemini 3.1 Flash
//   gpt-4o-mini                          → GPT-4o mini
//   llama-3.3-70b-versatile              → Llama 3.3 70B
// Ham kimlik her zaman ipucu (title) olarak gösterilmeye devam eder.

const BRANDS: Record<string, string> = {
  deepseek: 'DeepSeek', gemini: 'Gemini', gemma: 'Gemma', llama: 'Llama', qwen: 'Qwen',
  mistral: 'Mistral', mixtral: 'Mixtral', ministral: 'Ministral', codestral: 'Codestral',
  devstral: 'Devstral', magistral: 'Magistral', grok: 'Grok', kimi: 'Kimi', glm: 'GLM',
  phi: 'Phi', command: 'Command', minimax: 'MiniMax', nemotron: 'Nemotron', hermes: 'Hermes',
  sonar: 'Sonar', olmo: 'OLMo', granite: 'Granite', starcoder: 'StarCoder', codellama: 'CodeLlama',
  claude: 'Claude', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable',
};

// Sona eklenen, ada bir şey katmayan ekler
const NOISE = /-(latest|preview|exp|experimental|free|instruct|it|chat|versatile|online|beta|alpha|\d{3})$/i;
const DATE = /[-_@](\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d{4})$/;

function word(t: string): string {
  if (BRANDS[t]) return BRANDS[t];
  const brand = Object.keys(BRANDS).find((b) => t.startsWith(b) && /^[\d.]+$/.test(t.slice(b.length)));
  if (brand) return BRANDS[brand] + t.slice(brand.length);       // qwen3 → Qwen3
  if (/^\d+(\.\d+)?[bkm]$/.test(t)) return t.toUpperCase();        // 70b → 70B
  if (/^a\d+b$/.test(t)) return t.toUpperCase();                   // a35b → A35B
  if (/^v?\d/.test(t)) return t;                                   // v4.1, 3.1, 4o
  return t.charAt(0).toUpperCase() + t.slice(1);                   // flash → Flash
}

export function prettyModel(raw: string): string {
  let s = raw.trim();
  if (!s) return raw;
  s = s.split('/').pop() ?? s;
  s = s.replace(/:.*$/, '');
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(NOISE, '');
    if (/\d/.test(s.replace(DATE, ''))) s = s.replace(DATE, '');
  }
  const lower = s.toLowerCase();

  // Claude: claude-opus-5-5, claude-3-5-sonnet, claude-sonnet-4.5
  const c = /^claude-(?:(\d+)(?:[-.](\d+))?-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:[-.](\d+))?)?/.exec(lower);
  if (c) {
    const major = c[4] ?? c[1];
    const minor = c[4] ? c[5] : c[2];
    return `${BRANDS[c[3]]}${major ? ` ${major}${minor ? `.${minor}` : ''}` : ''}`;
  }

  // GPT: gpt-4o-mini → GPT-4o mini, gpt-5.1-codex → GPT-5.1 codex
  const g = /^(?:chat)?gpt-(.+)$/.exec(lower);
  if (g) {
    const [head, ...rest] = g[1].split('-');
    return `GPT-${head}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  }

  // OpenAI o serisi: o4-mini → o4 mini
  if (/^o\d/.test(lower)) return lower.replace(/-/g, ' ');

  const tokens = lower.split(/[-_\s]+/).filter(Boolean);
  // Ayrı yazılmış sürüm parçalarını birleştir: glm-4-6 → GLM 4.6
  const merged: string[] = [];
  for (const t of tokens) {
    const last = merged[merged.length - 1];
    if (last && /^\d$/.test(t) && /^\d+$/.test(last)) merged[merged.length - 1] = `${last}.${t}`;
    else merged.push(t);
  }
  return merged.map(word).join(' ');
}
