import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWorkspaceRoot } from './setup';

const {
  githubOwner, parseFrontmatter, safeRelPath, skillBody, syncOrgSkill, syncOrgSkills,
  localSkills, removeLocalSkill, setSkillsRoot, skillsPromptBlock,
} = await import('../services/orgSkills');
const { buildPrompt } = await import('../services/ai');
const { parseSkills } = await import('../services/skills');

const SKILL_MD = [
  '---',
  'name: scale-engineer',
  'description: Estimates how many users an app can serve. Use when the user asks about capacity.',
  'license: MIT',
  'metadata:',
  '  author: tulvez',
  '---',
  '',
  '# Scale Engineer',
  '',
  'Run scripts/capacity.py.',
].join('\n');

describe('GitHub becerileri: ayrıştırma', () => {
  it('yalnız github.com/<hesap> adresini hesap sayar', () => {
    expect(githubOwner('https://github.com/tulvez')).toBe('tulvez');
    expect(githubOwner('https://github.com/tulvez/')).toBe('tulvez');
    expect(githubOwner('https://github.com/tulvez/scale-engineer')).toBeNull();
    expect(githubOwner('https://raw.githubusercontent.com/tulvez/x/main')).toBeNull();
    expect(githubOwner('http://github.com/tulvez')).toBeNull();
  });

  it('ön bilgiden ad ve açıklama; iç içe alanlar karışmaz', () => {
    expect(parseFrontmatter(SKILL_MD)).toEqual({
      name: 'scale-engineer',
      description: 'Estimates how many users an app can serve. Use when the user asks about capacity.',
    });
  });

  it('tırnaklı, katlanmış (>) ve CRLF değerler', () => {
    expect(parseFrontmatter('---\r\nname: "a-b"\r\ndescription: \'tek satır\'\r\n---\r\nx')).toEqual({ name: 'a-b', description: 'tek satır' });
    expect(parseFrontmatter('---\nname: c\ndescription: >\n  birinci\n  ikinci\n---\n')).toEqual({ name: 'c', description: 'birinci ikinci' });
  });

  it('ön bilgi, ad ya da açıklama yoksa beceri değildir', () => {
    expect(parseFrontmatter('# Başlık\n\nmetin')).toBeNull();
    expect(parseFrontmatter('---\nname: x\n---\n')).toBeNull();
  });

  it('gövde ön bilgisiz döner', () => {
    expect(skillBody(SKILL_MD)).toBe('# Scale Engineer\n\nRun scripts/capacity.py.');
  });

  it('klasör dışına çıkan ya da gizli yollar indirilmez', () => {
    expect(safeRelPath('scripts/capacity.py')).toBe(true);
    expect(safeRelPath('SKILL.md')).toBe(true);
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', '.github/workflows/a.yml', 'a/.git/config', 'a\\b', 'a//b', '']) {
      expect(safeRelPath(bad)).toBe(false);
    }
  });
});

describe('GitHub becerileri: indirme', () => {
  let root = '';
  let calls: string[] = [];
  let treeSha = 'sha1';

  const files: Record<string, string> = {
    'SKILL.md': SKILL_MD,
    'scripts/capacity.py': 'print("ok")\n',
    'references/methodology.md': '# Yöntem\n',
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-orgskills-'));
    calls = [];
    treeSha = 'sha1';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.startsWith('https://api.github.com/users/tulvez/repos')) {
        return json([
          { name: 'scale-engineer', default_branch: 'main', archived: false, fork: false, private: false },
          { name: 'geotrack', default_branch: 'main', archived: false, fork: false, private: false },
          { name: 'eski', default_branch: 'main', archived: true, fork: false, private: false },
        ]);
      }
      if (url.startsWith('https://api.github.com/repos/tulvez/scale-engineer/git/trees/main')) {
        return json({
          sha: treeSha,
          truncated: false,
          tree: [
            { path: 'SKILL.md', type: 'blob', size: 300 },
            { path: 'scripts', type: 'tree' },
            { path: 'scripts/capacity.py', type: 'blob', size: 12 },
            { path: 'references/methodology.md', type: 'blob', size: 10 },
            { path: '.github/workflows/x.yml', type: 'blob', size: 10 },
          ],
        });
      }
      const raw = /^https:\/\/raw\.githubusercontent\.com\/tulvez\/scale-engineer\/main\/(.+)$/.exec(url);
      if (raw && files[decodeURIComponent(raw[1])] !== undefined) return new Response(files[decodeURIComponent(raw[1])], { status: 200 });
      return new Response('Not Found', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSkillsRoot(undefined);
  });

  it('SKILL.md taşıyan depoyu bulur, bütün klasörü indirir; gizli dosya inmez', async () => {
    const r = await syncOrgSkills('tulvez', root, []);
    expect(r.catalog.map((s) => s.id)).toEqual(['scale-engineer']);
    expect(r.updated).toEqual(['scale-engineer']);
    expect(r.errors).toEqual([]);
    expect(calls.some((u) => u.includes('/eski/'))).toBe(false); // arşivlenmiş depoya bakılmaz
    const dir = path.join(root, 'scale-engineer');
    expect(fs.readFileSync(path.join(dir, 'scripts', 'capacity.py'), 'utf8')).toBe('print("ok")\n');
    expect(fs.existsSync(path.join(dir, 'references', 'methodology.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.github'))).toBe(false);
    expect(fs.readdirSync(root)).toEqual(['scale-engineer']); // geçici klasör kalmaz
    expect(localSkills(root)).toEqual([expect.objectContaining({ id: 'scale-engineer', dir, repo: 'tulvez/scale-engineer' })]);
  });

  it('depo değişmediyse yeniden indirmez; değişince günceller', async () => {
    const [skill] = (await syncOrgSkills('tulvez', root, [])).catalog;
    calls = [];
    expect(await syncOrgSkill(skill, root)).toBe(false);
    expect(calls.filter((u) => u.includes('raw.githubusercontent'))).toEqual([]);
    treeSha = 'sha2';
    files['scripts/capacity.py'] = 'print("v2")\n';
    expect(await syncOrgSkill(skill, root)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'scale-engineer', 'scripts', 'capacity.py'), 'utf8')).toBe('print("v2")\n');
    files['scripts/capacity.py'] = 'print("ok")\n';
  });

  it('kapatılan beceri indirilmez; kaldırılınca klasörü silinir', async () => {
    const r = await syncOrgSkills('tulvez', root, ['scale-engineer']);
    expect(r.catalog).toHaveLength(1);
    expect(localSkills(root)).toEqual([]);
    await syncOrgSkills('tulvez', root, []);
    removeLocalSkill(root, 'scale-engineer');
    expect(localSkills(root)).toEqual([]);
  });

  it('indirme yarıda kalırsa eski sürüm yerinde kalır', async () => {
    const [skill] = (await syncOrgSkills('tulvez', root, [])).catalog;
    treeSha = 'sha3';
    const saved = files['references/methodology.md'];
    delete files['references/methodology.md'];
    await expect(syncOrgSkill(skill, root)).rejects.toThrow(/indirilemedi/);
    files['references/methodology.md'] = saved;
    expect(fs.readFileSync(path.join(root, 'scale-engineer', 'scripts', 'capacity.py'), 'utf8')).toBe('print("ok")\n');
    expect(fs.readdirSync(root)).toEqual(['scale-engineer']);
  });

  it('kurulu beceri sistem istemine ve /skill listesine girer', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-ws-'));
    setWorkspaceRoot(ws);
    await syncOrgSkills('tulvez', root, []);
    setSkillsRoot(root);
    const block = skillsPromptBlock(localSkills(root));
    expect(block).toContain('- scale-engineer: Estimates how many users');
    expect(block).toContain(path.join(root, 'scale-engineer', 'SKILL.md'));
    expect(buildPrompt('build', '', block)).toContain('read_file ile o becerinin SKILL.md');
    const skill = parseSkills().find((s) => s.name === 'scale-engineer');
    expect(skill?.text).toContain('Run scripts/capacity.py.');
    expect(skill?.text).toContain(path.join(root, 'scale-engineer'));
    expect(skill?.text).not.toContain('description:');
  });

  it('beceri yoksa istemde beceri bölümü olmaz', () => {
    expect(skillsPromptBlock([])).toBe('');
    expect(buildPrompt('build', '')).not.toContain('Kurulu beceriler');
  });
});
