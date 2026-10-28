import type { ModelMessage } from 'ai';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentMode, ChatTurn } from '../../src/services/types';

/**
 * Oturum kaydı (Claude Code'un --resume / --continue'su gibi): her tamamlanan yanıttan sonra konuşma
 * ayar klasörüne yazılır, sonra aynı klasörde kaldığı yerden sürdürülür. Kayıt kod ve komut çıktısı
 * içerebilir: dosya izni 600, en çok 50 oturum tutulur.
 */

export interface SessionRecord {
  id: string;
  /** Çalışma klasörü (oturumlar klasöre göre listelenir) */
  root: string;
  /** İlk isteğin kısaltılmışı */
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: AgentMode;
  model: string;
  /** Ekranda yeniden gösterilecek düz metin geçmiş */
  history: ChatTurn[];
  /** Modelin tam konuşması (araç çağrıları ve sonuçları); yoksa düz metin geçmişten sürer */
  prior: ModelMessage[] | null;
}

const MAX_SESSIONS = 50;

export function sessionsDir(configDir: string): string {
  return path.join(configDir, 'sessions');
}

export function newSessionId(): string {
  return randomUUID();
}

export function sessionTitle(prompt: string): string {
  const line = prompt.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** Yazma yarıda kalırsa eski kayıt bozulmasın diye geçici dosya + yeniden adlandırma. */
export function saveSession(dir: string, record: SessionRecord): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${record.id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows'ta izin yok sayılır */ }
  prune(dir);
}

function readRecord(file: string): SessionRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8')) as SessionRecord;
    return r && typeof r.id === 'string' && Array.isArray(r.history) ? r : null;
  } catch {
    return null;
  }
}

/** Klasördeki oturumlar, en yeni önce. `root` verilirse yalnız o çalışma klasörününkiler. */
export function listSessions(dir: string, root?: string): SessionRecord[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const norm = (p: string): string => path.resolve(p).toLowerCase();
  return names
    .map((n) => readRecord(path.join(dir, n)))
    .filter((r): r is SessionRecord => !!r && (!root || norm(r.root) === norm(root)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(dir: string, id: string): SessionRecord | null {
  if (!/^[\w-]+$/.test(id)) return null;
  return readRecord(path.join(dir, `${id}.json`));
}

function prune(dir: string): void {
  const all = listSessions(dir);
  for (const r of all.slice(MAX_SESSIONS)) {
    try { fs.unlinkSync(path.join(dir, `${r.id}.json`)); } catch { /* silinemezse kalır */ }
  }
}

/** "3 dk önce", "dün 14:05" gibi kısa zaman */
export function ago(ts: number, now = Date.now()): string {
  const min = Math.round((now - ts) / 60_000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24);
  return d === 1 ? 'dün' : `${d} gün önce`;
}
