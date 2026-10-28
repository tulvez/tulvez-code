import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';
import { ago, listSessions, loadSession, saveSession, sessionTitle, type SessionRecord } from './sessions';

const rec = (id: string, root: string, updatedAt: number): SessionRecord => ({
  id, root, title: `istek ${id}`, createdAt: updatedAt, updatedAt, mode: 'build', model: 'm',
  history: [{ role: 'user', text: 'merhaba' }, { role: 'assistant', text: 'selam' }], prior: null,
});

describe('oturum kaydı', () => {
  it('kaydeder, klasöre göre en yeni önce listeler, kimlikle açar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-oturum-'));
    saveSession(dir, rec('a', '/proje', 1));
    saveSession(dir, rec('b', '/proje', 3));
    saveSession(dir, rec('c', '/baska', 2));
    expect(listSessions(dir, '/proje').map((r) => r.id)).toEqual(['b', 'a']);
    expect(listSessions(dir).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(loadSession(dir, 'b')?.history[1].text).toBe('selam');
    expect(loadSession(dir, '../a')).toBeNull();
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'a.json')).mode & 0o777).toBe(0o600);
  });

  it('en çok 50 oturum tutulur, eskiler silinir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-oturum-'));
    for (let i = 0; i < 53; i++) saveSession(dir, rec(`s${i}`, '/p', i));
    const ids = listSessions(dir).map((r) => r.id);
    expect(ids).toHaveLength(50);
    expect(ids).not.toContain('s0');
  });

  it('bozuk dosya listeyi bozmaz; başlık ve zaman', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-oturum-'));
    fs.writeFileSync(path.join(dir, 'bozuk.json'), '{');
    saveSession(dir, rec('a', '/p', 1));
    expect(listSessions(dir).map((r) => r.id)).toEqual(['a']);
    expect(sessionTitle('  çok\n satırlı   istek ')).toBe('çok satırlı istek');
    expect(ago(Date.now() - 5 * 60_000)).toBe('5 dk önce');
  });

  it('-c / --continue ve -r / --resume', () => {
    expect(parseArgs(['-c']).continueLast).toBe(true);
    expect(parseArgs(['--resume']).resume).toBe(true);
  });
});
