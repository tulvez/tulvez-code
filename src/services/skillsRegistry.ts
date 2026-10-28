import * as fs from 'fs';
import * as path from 'path';
import { host } from './host';
import { L } from './i18n';

/**
 * Tulvez Code skills deposu.
 *
 * Depo (varsayılan github.com/tulvez/tulvez-code-skills) kökünde bir `index.json` taşır:
 *
 *   {
 *     "version": 1,
 *     "skills": [
 *       { "id": "test-yaz", "name": "Test yaz", "description": "…", "file": "skills/test-yaz.md",
 *         "tags": ["test"], "version": "1.0.0" }
 *     ]
 *   }
 *
 * Kurulan skill çalışma alanında `.tulvez/skills/<id>.md` olarak durur; `/skill <id>` ile çalışır.
 * Dosyanın ilk `# Başlık` satırı görünen addır, gerisi talimattır.
 */

// Varsayılan: GitHub hesabı (orgSkills.ts). https://…/index.json taşıyan başka bir adres verilirse eski depo biçimi.
export const DEFAULT_REGISTRY = 'https://github.com/tulvez';
const MAX_INDEX_BYTES = 256 * 1024;
const MAX_SKILL_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

export interface RegistrySkill {
  id: string;
  name: string;
  description: string;
  file: string;
  tags: string[];
  version?: string;
}

export interface InstalledSkill {
  id: string;
  name: string;
  text: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// 0.2.3'e kadarki varsayılan; bu depo hiç yayımlanmadı. Ayar dosyasına bu değer yazılmışsa yeni varsayılan kullanılır.
const LEGACY_DEFAULT = 'https://raw.githubusercontent.com/tulvez/tulvez-code-skills/main';

export function registryBase(): string {
  const raw = (host().setting<string | undefined>('skillsRegistry', undefined)?.trim() || DEFAULT_REGISTRY).replace(/\/+$/, '');
  return raw === LEGACY_DEFAULT ? DEFAULT_REGISTRY : raw;
}

/** index.json'u doğrular; bozuk ya da tehlikeli (../ içeren yol, geçersiz kimlik) kayıtları atar. */
export function parseIndex(json: unknown): RegistrySkill[] {
  if (!json || typeof json !== 'object') throw new Error(L('index.json geçersiz', 'index.json is invalid'));
  const list = (json as { skills?: unknown }).skills;
  if (!Array.isArray(list)) throw new Error(L('index.json içinde "skills" listesi yok', 'index.json has no "skills" list'));
  const out: RegistrySkill[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    const file = typeof s.file === 'string' ? s.file.trim() : '';
    if (!ID_RE.test(id)) continue;
    if (!file || file.startsWith('/') || file.includes('..') || file.includes('\\') || !file.endsWith('.md')) continue;
    out.push({
      id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : id,
      description: typeof s.description === 'string' ? s.description.trim().slice(0, 300) : '',
      file,
      tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string').slice(0, 6) : [],
      version: typeof s.version === 'string' ? s.version.slice(0, 20) : undefined,
    });
  }
  return out;
}

async function fetchText(url: string, maxBytes: number): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new Error(L('Skills deposu adresi https ile başlamalı', 'The skills repository address must start with https'));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'tulvez-code' } });
    if (res.status === 404) throw new Error(L('Bulunamadı (404) — depo henüz yayında değil ya da adres yanlış', 'Not found (404) — the repository is not published yet or the address is wrong'));
    if (!res.ok) throw new Error(L(`Depo yanıt vermedi (HTTP ${res.status})`, `The repository did not respond (HTTP ${res.status})`));
    const text = await res.text();
    if (text.length > maxBytes) throw new Error(L('Dosya çok büyük', 'The file is too large'));
    return text;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(L('Depo zaman aşımına uğradı', 'The repository timed out'));
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRegistry(base = registryBase()): Promise<RegistrySkill[]> {
  const text = await fetchText(`${base}/index.json`, MAX_INDEX_BYTES);
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error(L('index.json okunamadı (JSON değil)', 'Could not read index.json (not JSON)')); }
  return parseIndex(json);
}

function skillsDir(): string | undefined {
  const root = host().workspaceRoot();
  return root ? path.join(root, '.tulvez', 'skills') : undefined;
}

/** "# Başlık" ilk satırı ad, kalanı talimattır. */
export function splitSkillFile(id: string, content: string): InstalledSkill {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  const heading = first >= 0 ? /^#\s+(.+)$/.exec(lines[first].trim()) : null;
  const name = heading ? heading[1].trim() : id;
  const text = (heading ? lines.slice(first + 1) : lines).join('\n').trim();
  return { id, name, text };
}

export function installedSkills(): InstalledSkill[] {
  const dir = skillsDir();
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && ID_RE.test(f.slice(0, -3)))
    .sort()
    .map((f) => {
      const id = f.slice(0, -3);
      try { return splitSkillFile(id, fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
    })
    .filter((s): s is InstalledSkill => !!s && !!s.text);
}

export async function installSkill(entry: RegistrySkill, base = registryBase()): Promise<void> {
  const dir = skillsDir();
  if (!dir) throw new Error(L('Önce bir klasör aç: skill çalışma alanına kurulur', 'Open a folder first: the skill is installed into the workspace'));
  if (!ID_RE.test(entry.id)) throw new Error(L('Geçersiz skill kimliği', 'Invalid skill id'));
  const content = await fetchText(`${base}/${entry.file}`, MAX_SKILL_BYTES);
  if (!content.trim()) throw new Error(L('Skill dosyası boş', 'The skill file is empty'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entry.id}.md`), content, 'utf8');
}

export function removeSkill(id: string): void {
  const dir = skillsDir();
  if (!dir || !ID_RE.test(id)) return;
  const file = path.join(dir, `${id}.md`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
