import * as fs from 'fs';
import * as path from 'path';

/**
 * GitHub hesabındaki beceriler (varsayılan github.com/tulvez).
 *
 * Hesabın herkese açık depolarından kökünde `SKILL.md` olan her biri bir beceridir (Agent Skills
 * biçimi: YAML ön bilgide `name` + `description`, altında talimat). Ayrı bir liste tutulmaz:
 * yeni beceri = yeni depo. Becerinin bütün klasörü (betikler, belgeler) eklentinin kendi alanına
 * iner, her çalışma alanında kullanılır. Ajan adları ve açıklamaları sistem isteminde görür;
 * istek bir beceriye uyarsa önce SKILL.md'yi okur.
 */

export interface SkillMeta {
  name: string;
  description: string;
}

export interface OrgSkill extends SkillMeta {
  id: string;
  repo: string;
  branch: string;
}

export interface LocalSkill extends SkillMeta {
  id: string;
  dir: string;
  repo?: string;
  /** github: hesaptan indi · local: bilgisayardan yüklendi */
  source: 'github' | 'local';
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TIMEOUT_MS = 15_000;
const MAX_REPOS = 40;
const MAX_FILES = 300;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_MD_BYTES = 256 * 1024;
const STAMP = '.tulvez-skill.json';

/** "https://github.com/<hesap>" → hesap; başka adres (index.json deposu) → null. */
export function githubOwner(source: string): string | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/?$/i.exec(source.trim());
  return m ? m[1] : null;
}

/** SKILL.md ön bilgisinden name/description (düz, tırnaklı ya da `>`/`|` blok değer). */
export function parseFrontmatter(content: string): SkillMeta | null {
  const text = content.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!m) return null;
  const lines = m[1].split('\n');
  const values: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        block.push(lines[++i].trim());
      }
      value = block.join(value.startsWith('>') ? ' ' : '\n').trim();
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    values[kv[1]] = value;
  }
  const name = (values.name ?? '').trim();
  const description = (values.description ?? '').trim();
  if (!name || !description) return null;
  return { name: name.slice(0, 64), description: description.slice(0, 1024) };
}

/** SKILL.md'nin ön bilgisiz gövdesi (/skill komutu için). */
export function skillBody(content: string): string {
  return content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

/** "Kod İnceleme" → "kod-inceleme": Türkçe harfler sadeleşir, kalan her şey tireye döner. */
function slug(text: string): string {
  return text.replace(/[İı]/g, 'i').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function skillId(name: string, repo: string): string {
  const fromName = slug(name);
  return ID_RE.test(fromName) ? fromName : slug(repo);
}

/** Depodan inen yol klasör dışına çıkamaz; gizli dosyalar (.git*, .github) atlanır. */
export function safeRelPath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..' && !seg.startsWith('.'));
}

async function get(url: string, accept?: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'User-Agent': 'tulvez-code' };
    if (accept) headers.Accept = accept;
    return await fetch(url, { signal: ctrl.signal, headers });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('GitHub zaman aşımına uğradı');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await get(url, 'application/vnd.github+json');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub istek sınırı doldu, biraz sonra tekrar dene');
  if (!res.ok) throw new Error(`GitHub yanıt vermedi (HTTP ${res.status})`);
  return (await res.json()) as T;
}

const rawUrl = (owner: string, repo: string, branch: string, file: string): string =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file.split('/').map(encodeURIComponent).join('/')}`;

/** Hesabın herkese açık depolarından SKILL.md taşıyanları bulur. */
export async function discoverOrgSkills(owner: string): Promise<OrgSkill[]> {
  type Repo = { name: string; default_branch: string; archived: boolean; fork: boolean; private: boolean };
  const repos = await getJson<Repo[]>(`https://api.github.com/users/${owner}/repos?per_page=100&type=owner&sort=pushed`);
  const candidates = repos.filter((r) => !r.archived && !r.fork && !r.private).slice(0, MAX_REPOS);
  const found = await Promise.all(candidates.map(async (r): Promise<OrgSkill | null> => {
    try {
      const res = await get(rawUrl(owner, r.name, r.default_branch, 'SKILL.md'));
      if (!res.ok) return null;
      const meta = parseFrontmatter((await res.text()).slice(0, MAX_SKILL_MD_BYTES));
      if (!meta) return null;
      return { ...meta, id: skillId(meta.name, r.name), repo: `${owner}/${r.name}`, branch: r.default_branch };
    } catch {
      return null;
    }
  }));
  const seen = new Set<string>();
  return found.filter((s): s is OrgSkill => !!s && !seen.has(s.id) && !!seen.add(s.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readStamp(dir: string): { repo?: string; sha?: string; source?: string } {
  try { return JSON.parse(fs.readFileSync(path.join(dir, STAMP), 'utf8')); } catch { return {}; }
}

/**
 * Becerinin klasörünü indirir. Depo değişmediyse (aynı ağaç sha'sı) hiçbir şey indirilmez.
 * Önce geçici klasöre yazılır, tamamlanınca eskisinin yerine geçer: yarım kurulum kalmaz.
 * Dönüş: true = yeni/güncellendi.
 */
export async function syncOrgSkill(skill: OrgSkill, root: string): Promise<boolean> {
  if (!ID_RE.test(skill.id)) throw new Error('Geçersiz beceri kimliği');
  const dest = path.join(root, skill.id);
  const stamp = readStamp(dest);
  // Aynı adla bilgisayardan yüklenen beceri GitHub'dakinin üstüne yazılmaz.
  if (stamp.source === 'local' && fs.existsSync(path.join(dest, 'SKILL.md'))) return false;
  const [owner, repo] = skill.repo.split('/');
  type Tree = { sha: string; truncated: boolean; tree: { path: string; type: string; size?: number }[] };
  const tree = await getJson<Tree>(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(skill.branch)}?recursive=1`);
  if (stamp.sha === tree.sha && stamp.repo === skill.repo && fs.existsSync(path.join(dest, 'SKILL.md'))) return false;

  const files = tree.tree.filter((t) => t.type === 'blob' && safeRelPath(t.path));
  if (tree.truncated || files.length > MAX_FILES) throw new Error(`${skill.repo}: çok fazla dosya`);
  const total = files.reduce((n, f) => n + (f.size ?? 0), 0);
  if (total > MAX_TOTAL_BYTES || files.some((f) => (f.size ?? 0) > MAX_FILE_BYTES)) throw new Error(`${skill.repo}: beceri çok büyük`);
  if (!files.some((f) => f.path === 'SKILL.md')) throw new Error(`${skill.repo}: SKILL.md yok`);

  fs.mkdirSync(root, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root, `.${skill.id}-`));
  try {
    for (const f of files) {
      const res = await get(rawUrl(owner, repo, skill.branch, f.path));
      if (!res.ok) throw new Error(`${f.path} indirilemedi (HTTP ${res.status})`);
      const target = path.join(tmp, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    }
    fs.writeFileSync(path.join(tmp, STAMP), JSON.stringify({ repo: skill.repo, sha: tree.sha, syncedAt: new Date().toISOString() }));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    return true;
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** Kurulu (indirilmiş) beceriler: SKILL.md'si okunabilen her klasör. */
export function localSkills(root: string | undefined): LocalSkill[] {
  if (!root || !fs.existsSync(root)) return [];
  const out: LocalSkill[] = [];
  for (const id of fs.readdirSync(root).sort()) {
    if (!ID_RE.test(id)) continue;
    const dir = path.join(root, id);
    try {
      const meta = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
      const stamp = readStamp(dir);
      if (meta) out.push({ ...meta, id, dir, repo: stamp.repo, source: stamp.source === 'local' ? 'local' : 'github' });
    } catch { /* SKILL.md yok ya da okunamadı */ }
  }
  return out;
}

export function removeLocalSkill(root: string | undefined, id: string): void {
  if (!root || !ID_RE.test(id)) return;
  fs.rmSync(path.join(root, id), { recursive: true, force: true });
}

/** Klasörü sınırlar içinde kopyalar; gizli dosyalar ve sembolik bağlar atlanır. */
function copyTree(src: string, dest: string, budget = { files: 0, bytes: 0 }): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__pycache__') continue;
      copyTree(from, to, budget);
    } else if (e.isFile()) {
      const size = fs.statSync(from).size;
      budget.files += 1;
      budget.bytes += size;
      if (budget.files > MAX_FILES || size > MAX_FILE_BYTES || budget.bytes > MAX_TOTAL_BYTES) {
        throw new Error('Beceri çok büyük (en çok 300 dosya, 8 MB)');
      }
      fs.copyFileSync(from, to);
    }
  }
}

/** .md içeriğini beceriye çevirir: ön bilgi yoksa ad dosya adından, açıklama ilk dolu satırdan üretilir. */
function mdToSkill(content: string, fileBase: string): { meta: SkillMeta; skillMd: string } {
  const meta = parseFrontmatter(content);
  if (meta) return { meta, skillMd: content };
  const body = skillBody(content);
  const first = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? fileBase;
  const made = { name: fileBase, description: first.slice(0, 300) };
  return { meta: made, skillMd: `---\nname: ${slug(fileBase)}\ndescription: ${JSON.stringify(made.description)}\n---\n\n${body}\n` };
}

const isMd = (name: string): boolean => /\.md$/i.test(name) && !name.startsWith('.');

/**
 * Klasörün beceri dosyası: SKILL.md (harf büyüklüğü fark etmez) ya da klasördeki tek .md.
 * Birden çok .md varsa ve hiçbiri SKILL.md değilse klasör tek beceri sayılmaz (koleksiyondur).
 */
function skillFileIn(dir: string): string | null {
  const mds = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && isMd(e.name)).map((e) => e.name);
  const named = mds.find((n) => n.toLowerCase() === 'skill.md');
  if (named) return path.join(dir, named);
  return mds.length === 1 ? path.join(dir, mds[0]) : null;
}

function installLocal(meta: SkillMeta, skillMd: string, root: string, fallbackName: string, fromDir?: string, skillFile?: string): LocalSkill {
  const id = skillId(meta.name, fallbackName);
  if (!ID_RE.test(id)) throw new Error(`${fallbackName}: becerinin adı geçersiz`);
  fs.mkdirSync(root, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root, `.${id}-`));
  try {
    if (fromDir) copyTree(fromDir, tmp);
    // Beceri dosyası başka adlıysa (ör. rapor.md) SKILL.md olarak yazılır, kopyası kalmaz
    if (skillFile && path.basename(skillFile) !== 'SKILL.md') fs.rmSync(path.join(tmp, path.basename(skillFile)), { force: true });
    fs.writeFileSync(path.join(tmp, 'SKILL.md'), skillMd, 'utf8');
    fs.writeFileSync(path.join(tmp, STAMP), JSON.stringify({ source: 'local', importedAt: new Date().toISOString() }));
    const dest = path.join(root, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    return { ...meta, id, dir: dest, source: 'local' };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Bilgisayardaki tek bir beceriyi kurar:
 * - herhangi bir adla .md dosyası (rapor.md → "rapor"),
 * - SKILL.md ya da tek .md içeren klasör (betik ve belgeleriyle birlikte).
 */
export function importLocalSkill(src: string, root: string): LocalSkill {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const file = skillFileIn(src);
    if (!file) throw new Error(`${path.basename(src)}: klasörde beceri dosyası (.md) yok`);
    if (fs.statSync(file).size > MAX_SKILL_MD_BYTES) throw new Error(`${path.basename(file)} çok büyük`);
    const { meta, skillMd } = mdToSkill(fs.readFileSync(file, 'utf8'), path.basename(src));
    return installLocal(meta, skillMd, root, path.basename(src), src, file);
  }
  if (!isMd(path.basename(src))) throw new Error(`${path.basename(src)}: yalnız .md dosyası ya da klasör yüklenebilir`);
  if (stat.size > MAX_SKILL_MD_BYTES) throw new Error(`${path.basename(src)} çok büyük`);
  const base = path.basename(src).replace(/\.md$/i, '');
  const { meta, skillMd } = mdToSkill(fs.readFileSync(src, 'utf8'), base);
  return installLocal(meta, skillMd, root, base);
}

/**
 * Seçilen her şeyi kurar. Beceri dosyası olmayan klasör bir koleksiyon sayılır: içindeki her
 * .md dosyası ve beceri dosyası olan her alt klasör ayrı beceri olur. Biri hata verirse diğerleri sürer.
 */
export function importLocalSkills(sources: string[], root: string): { imported: LocalSkill[]; errors: string[] } {
  const imported: LocalSkill[] = [];
  const errors: string[] = [];
  const one = (src: string): void => {
    try { imported.push(importLocalSkill(src, root)); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  };
  for (const src of sources) {
    let isDir = false;
    try { isDir = fs.statSync(src).isDirectory(); } catch { errors.push(`${path.basename(src)} okunamadı`); continue; }
    if (!isDir || skillFileIn(src)) { one(src); continue; }
    const entries = fs.readdirSync(src, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
    const items = entries
      .filter((e) => (e.isFile() && isMd(e.name)) || (e.isDirectory() && skillFileIn(path.join(src, e.name))))
      .map((e) => path.join(src, e.name));
    if (items.length === 0) errors.push(`${path.basename(src)}: klasörde beceri bulunamadı`);
    items.forEach(one);
  }
  return { imported, errors };
}

/** Kurulu beceriyi <hedef>/<ad> klasörüne kopyalar (eklentinin iç dosyası hariç). Dönüş: yeni klasör. */
export function exportLocalSkill(root: string, id: string, destParent: string): string {
  if (!ID_RE.test(id)) throw new Error('Geçersiz beceri kimliği');
  const src = path.join(root, id);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw new Error('Beceri kurulu değil');
  const dest = path.join(destParent, id);
  if (fs.existsSync(dest)) throw new Error(`${dest} zaten var`);
  copyTree(src, dest);
  return dest;
}

// Eklenti açılışta ayarlar (globalStorage/skills). Testler kendi klasörünü verir.
let skillsRoot: string | undefined;
export function setSkillsRoot(dir: string | undefined): void { skillsRoot = dir; }
export function getSkillsRoot(): string | undefined { return skillsRoot; }

/** Sistem istemine giren beceri listesi; kurulu beceri yoksa boş. */
export function skillsPromptBlock(skills: LocalSkill[]): string {
  if (skills.length === 0) return '';
  const list = skills.map((s) => `- ${s.id}: ${s.description}\n  SKILL.md: ${path.join(s.dir, 'SKILL.md')}`).join('\n');
  return [
    'Kurulu beceriler (skills):',
    list,
    '',
    'Kullanıcının isteği bir becerinin açıklamasına uyuyorsa işe başlamadan önce read_file ile o becerinin SKILL.md dosyasını oku ve talimatlarına uy. ' +
    'SKILL.md içindeki göreli yollar (scripts/, references/, assets/) becerinin klasörüne göredir; gerektiğinde onları da oku ya da çalıştır. ' +
    'İstek hiçbir beceriye uymuyorsa becerilerden söz etme.',
  ].join('\n');
}

export interface SyncResult {
  catalog: OrgSkill[];
  updated: string[];
  errors: string[];
}

/** Hesaptaki becerileri bulur, kapatılmamış olanları indirir/günceller. Bir becerinin hatası diğerlerini durdurmaz. */
export async function syncOrgSkills(owner: string, root: string, disabled: readonly string[]): Promise<SyncResult> {
  const catalog = await discoverOrgSkills(owner);
  const updated: string[] = [];
  const errors: string[] = [];
  for (const skill of catalog) {
    if (disabled.includes(skill.id)) continue;
    try {
      if (await syncOrgSkill(skill, root)) updated.push(skill.id);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { catalog, updated, errors };
}
