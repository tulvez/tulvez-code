/**
 * İzin kuralları (Claude Code biçiminde), cli.json → "permissions": { "allow": [...], "deny": [...] }.
 *
 *   "run_command(npm test*)"   — komut bu kalıba uyarsa
 *   "Bash(git status:*)"        — Claude Code adları ve "önek:*" yazımı da geçer
 *   "write_file(.env*)"         — dosya yolu
 *   "web_fetch(https://docs.*)" — adres
 *   "web_search"                — aracın tamamı
 *
 * Önce "deny" bakılır (araç hiç çalışmaz), sonra "allow" (onay sorulmaz); ikisi de değilse her zamanki onay.
 */

export interface PermissionRules {
  allow?: string[];
  deny?: string[];
}

// Claude Code araç adları → Tulvez Code araçları
const ALIASES: Record<string, string[]> = {
  bash: ['run_command', 'run_in_background'],
  write: ['write_file'],
  edit: ['replace_in_file'],
  multiedit: ['replace_in_file'],
  read: ['read_file', 'read_files'],
  grep: ['grep_files'],
  ls: ['list_dir', 'list_files'],
  webfetch: ['web_fetch'],
  websearch: ['web_search'],
};

/** Kuralın uygulandığı değer: komut, yol, adres ya da sorgu */
export function ruleSubject(tool: string, args: Record<string, unknown>): string[] {
  if (tool === 'run_command' || tool === 'run_in_background') return [String(args.command ?? '')];
  if (tool === 'read_files') return Array.isArray(args.paths) ? (args.paths as unknown[]).map(String) : [];
  if ('path' in args) return [String(args.path ?? '')];
  if (tool === 'web_fetch') return [String(args.url ?? '')];
  if (tool === 'web_search') return [String(args.query ?? '')];
  if (tool === 'grep_files') return [String(args.pattern ?? '')];
  if (tool === 'list_dir' || tool === 'list_files') return [String(args.directory ?? '.')];
  return [JSON.stringify(args)];
}

function globToRegExp(glob: string): RegExp {
  // Claude Code'un "npm test:*" yazımı "npm test*" demek
  const g = glob.replace(/:\*$/, '*');
  const body = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 's');
}

interface ParsedRule { tools: string[]; pattern: RegExp | null }

function parseRule(rule: string): ParsedRule | null {
  const m = /^\s*([\w-]+)\s*(?:\((.*)\))?\s*$/s.exec(rule);
  if (!m) return null;
  const name = m[1];
  const tools = ALIASES[name.toLowerCase()] ?? [name];
  return { tools, pattern: m[2] !== undefined && m[2] !== '*' ? globToRegExp(m[2].trim()) : null };
}

export function matchesRule(rule: string, tool: string, args: Record<string, unknown>): boolean {
  const r = parseRule(rule);
  if (!r || !r.tools.includes(tool)) return false;
  if (!r.pattern) return true;
  const subjects = ruleSubject(tool, args);
  // Birden çok yol (read_files): hepsi uymalı
  return subjects.length > 0 && subjects.every((s) => r.pattern!.test(s.trim()));
}

export function decide(rules: PermissionRules | undefined, tool: string, args: Record<string, unknown>): { decision: 'allow' | 'deny' | 'ask'; rule?: string } {
  const deny = (rules?.deny ?? []).find((r) => matchesRule(r, tool, args));
  if (deny) return { decision: 'deny', rule: deny };
  const allow = (rules?.allow ?? []).find((r) => matchesRule(r, tool, args));
  if (allow) return { decision: 'allow', rule: allow };
  return { decision: 'ask' };
}
