import { spawn } from 'child_process';
import { shellInvocation } from '../../src/services/tools';

/**
 * Hook'lar (Claude Code biçiminde), cli.json → "hooks". Yalnız kullanıcının kendi ayar dosyasından okunur;
 * proje dosyaları hook tanımlayamaz (depodaki bir dosya bilgisayarında komut çalıştıramasın).
 *
 *   "hooks": {
 *     "PreToolUse":  [{ "matcher": "run_command", "command": "node guard.js" }],
 *     "PostToolUse": [{ "matcher": "write_file|replace_in_file", "command": "npx prettier --write \"$TULVEZ_FILE\"" }],
 *     "UserPromptSubmit": [{ "command": "…" }],
 *     "Stop": [{ "command": "notify-send 'Tulvez Code bitti'" }]
 *   }
 *
 * Komut stdin'den JSON alır (olay, araç, argümanlar, sonuç, klasör, oturum). Ortam: TULVEZ_HOOK_EVENT,
 * TULVEZ_TOOL, TULVEZ_FILE (yol argümanı varsa). Çıkış 2: PreToolUse aracı, UserPromptSubmit isteği engeller;
 * stderr gerekçe olarak modele (ya da kullanıcıya) gider. PostToolUse'da çıkış 2'nin stderr'i araç sonucuna
 * eklenir. UserPromptSubmit'in stdout'u isteğe bağlam olarak eklenir. Her hook en çok 60 sn.
 */

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop';
export const HOOK_EVENTS: HookEvent[] = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'];

export interface HookEntry {
  /** Araç adı için düzenli ifade (PreToolUse/PostToolUse); yoksa her araç */
  matcher?: string;
  command: string;
  /** Saniye (varsayılan 60) */
  timeout?: number;
}

export type HooksConfig = Partial<Record<HookEvent, HookEntry[]>>;

export interface HookOutcome {
  /** Çıkış 2 ile engellendi */
  blocked: boolean;
  /** Engelleme gerekçesi ya da modele eklenecek metin */
  message: string;
  /** stdout (UserPromptSubmit'te bağlam) */
  stdout: string;
}

const MAX_OUTPUT = 8000;

/** cli.json'daki hook tanımını doğrular; bozuk girişler atlanır */
export function parseHooks(raw: unknown): HooksConfig {
  if (!raw || typeof raw !== 'object') return {};
  const out: HooksConfig = {};
  for (const ev of HOOK_EVENTS) {
    const list = (raw as Record<string, unknown>)[ev];
    if (!Array.isArray(list)) continue;
    const entries = list.filter((e): e is HookEntry => !!e && typeof e === 'object' && typeof (e as HookEntry).command === 'string' && !!(e as HookEntry).command.trim());
    if (entries.length) out[ev] = entries;
  }
  return out;
}

export function hookMatches(entry: HookEntry, tool: string | undefined): boolean {
  if (!entry.matcher || entry.matcher === '*' || tool === undefined) return true;
  try {
    return new RegExp(`^(?:${entry.matcher})$`).test(tool);
  } catch {
    return entry.matcher === tool;
  }
}

function runOne(entry: HookEntry, payload: Record<string, unknown>, cwd: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const inv = shellInvocation(entry.command);
    const child = spawn(inv.file, inv.args, {
      cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: inv.windowsVerbatimArguments,
    });
    let stdout = '';
    let stderr = '';
    const cap = (s: string, d: Buffer): string => (s.length < MAX_OUTPUT ? s + d.toString('utf8') : s);
    child.stdout.on('data', (d: Buffer) => { stdout = cap(stdout, d); });
    child.stderr.on('data', (d: Buffer) => { stderr = cap(stderr, d); });
    const timer = setTimeout(() => {
      stderr += `\n(hook ${entry.timeout ?? 60} sn içinde bitmedi, durduruldu)`;
      child.kill();
    }, (entry.timeout ?? 60) * 1000);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${err.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT) }); });
    child.stdin.on('error', () => { /* hook stdin'i okumadı */ });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Olayın uyan hook'larını sırayla çalıştırır; biri engellerse durur. */
export async function runHooks(
  hooks: HooksConfig,
  event: HookEvent,
  ctx: { cwd: string; sessionId: string; tool?: string; input?: Record<string, unknown>; output?: string; prompt?: string },
): Promise<HookOutcome> {
  const entries = (hooks[event] ?? []).filter((e) => hookMatches(e, ctx.tool));
  const result: HookOutcome = { blocked: false, message: '', stdout: '' };
  for (const entry of entries) {
    const file = ctx.input && typeof ctx.input.path === 'string' ? ctx.input.path : '';
    const payload = { hook_event_name: event, session_id: ctx.sessionId, cwd: ctx.cwd, tool_name: ctx.tool, tool_input: ctx.input, tool_response: ctx.output, prompt: ctx.prompt };
    const r = await runOne(entry, payload, ctx.cwd, { TULVEZ_HOOK_EVENT: event, TULVEZ_TOOL: ctx.tool ?? '', TULVEZ_FILE: file });
    if (r.stdout.trim()) result.stdout += `${result.stdout ? '\n' : ''}${r.stdout.trim()}`;
    if (r.code === 2) {
      result.blocked = true;
      result.message = r.stderr.trim() || `${event} hook'u engelledi (${entry.command})`;
      break;
    }
  }
  return result;
}
