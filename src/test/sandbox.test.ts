import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setWorkspaceRoot } from './setup';

const { executeTool, resolveEditPath } = await import('../services/tools');
const { setSkillsRoot } = await import('../services/orgSkills');
const { toolsForMode } = await import('../services/agent');

let ws = '';
let outside = '';
let skills = '';

beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-ws-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-disari-'));
  skills = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-skills-'));
  await fs.writeFile(path.join(outside, 'gizli.txt'), 'GIZLI', 'utf8');
  await fs.mkdir(path.join(skills, 'scale-engineer'));
  await fs.writeFile(path.join(skills, 'scale-engineer', 'SKILL.md'), 'beceri', 'utf8');
  setWorkspaceRoot(ws);
  setSkillsRoot(skills);
});

afterEach(async () => {
  setSkillsRoot(undefined);
  for (const d of [ws, outside, skills]) await fs.rm(d, { recursive: true, force: true });
});

describe('araçlar yalnız çalışma alanında', () => {
  it('çalışma alanı dışı mutlak yol okunmaz, yazılmaz', async () => {
    const secret = path.join(outside, 'gizli.txt');
    expect(await executeTool('read_file', { path: secret }, false)).toMatch(/çalışma alanının dışında/);
    expect(await executeTool('read_files', { paths: [secret] }, false)).toMatch(/çalışma alanının dışında/);
    expect(await executeTool('list_dir', { directory: outside }, false)).toMatch(/çalışma alanının dışında/);
    expect(await executeTool('list_files', { directory: outside }, false)).toMatch(/çalışma alanının dışında/);
    expect(await executeTool('write_file', { path: path.join(outside, 'yeni.txt'), content: 'x' }, false)).toMatch(/dışında/);
    expect(await executeTool('replace_in_file', { path: secret, old_string: 'GIZLI', new_string: 'x' }, false)).toMatch(/dışında/);
    expect(await fs.readFile(secret, 'utf8')).toBe('GIZLI');
    await expect(fs.access(path.join(outside, 'yeni.txt'))).rejects.toThrow();
  });

  it('../ ile dışarı çıkılamaz', async () => {
    const rel = path.relative(ws, path.join(outside, 'gizli.txt'));
    expect(rel.startsWith('..')).toBe(true);
    expect(await executeTool('read_file', { path: rel }, false)).toMatch(/dışında/);
    expect(await executeTool('write_file', { path: '../kacis.txt', content: 'x' }, false)).toMatch(/dışında/);
  });

  it('sembolik bağla dışarı çıkılamaz', async () => {
    await fs.symlink(outside, path.join(ws, 'bag'), 'dir');
    expect(await executeTool('read_file', { path: 'bag/gizli.txt' }, false)).toMatch(/dışında/);
    expect(await executeTool('write_file', { path: 'bag/yeni/x.txt', content: 'x' }, false)).toMatch(/dışında/);
  });

  it('çalışma alanı içi göreli ve mutlak yol çalışır', async () => {
    expect(await executeTool('write_file', { path: 'alt/a.txt', content: 'ic' }, false)).toMatch(/Yazıldı/);
    expect(await executeTool('read_file', { path: path.join(ws, 'alt', 'a.txt') }, false)).toContain('ic');
    expect(resolveEditPath('alt/a.txt')).toBe(path.join(ws, 'alt', 'a.txt'));
    expect(resolveEditPath(path.join(outside, 'x'))).toBeNull();
  });

  it('kurulu becerinin dosyaları okunur ama değiştirilemez', async () => {
    const skillMd = path.join(skills, 'scale-engineer', 'SKILL.md');
    expect(await executeTool('read_file', { path: skillMd }, false)).toContain('beceri');
    expect(await executeTool('write_file', { path: skillMd, content: 'bozuk' }, false)).toMatch(/dışında/);
    expect(await fs.readFile(skillMd, 'utf8')).toBe('beceri');
  });
});

describe('modlara göre araçlar', () => {
  const names = (mode: 'ask' | 'plan' | 'build') => toolsForMode(mode).map((t) => t.name);
  it('Ask ve Plan yalnız okuma araçlarını görür', () => {
    for (const mode of ['ask', 'plan'] as const) {
      expect(names(mode)).toContain('read_file');
      for (const w of ['write_file', 'replace_in_file', 'run_command', 'run_in_background', 'stop_background']) {
        expect(names(mode)).not.toContain(w);
      }
    }
  });
  it('Build bütün araçları görür', () => {
    expect(names('build')).toEqual(expect.arrayContaining(['write_file', 'replace_in_file', 'run_command']));
  });
});
