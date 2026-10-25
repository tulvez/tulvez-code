import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { setWorkspaceRoot } from './setup';

const { beginCheckpoint, endCheckpoint, recordBefore, undoCheckpoint } = await import('../services/checkpoint');
const { executeTool } = await import('../services/tools');

let ws = '';
const f = (name: string) => path.join(ws, name);
const write = async (name: string, content: string) => {
  await recordBefore(f(name)); // ajan yazma aracından önce bunu çağırır
  return executeTool('write_file', { path: name, content }, false);
};

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-cp-'));
  setWorkspaceRoot(ws);
});

describe('geri al', () => {
  it('değişen dosya eski haline, yeni oluşturulan dosya silinir', async () => {
    fs.writeFileSync(f('a.txt'), 'eski', 'utf8');
    beginCheckpoint('r1');
    await write('a.txt', 'yeni');
    await write('a.txt', 'daha yeni'); // ikinci yazım ilk hali değiştirmez
    await write('alt/yeni.ts', 'x');
    const cp = await endCheckpoint();
    expect(cp?.files.sort()).toEqual([f('a.txt'), f('alt/yeni.ts')].sort());
    const r = await undoCheckpoint('r1', async () => { throw new Error('onay sorulmamalı'); });
    expect(r.restored).toHaveLength(2);
    expect(fs.readFileSync(f('a.txt'), 'utf8')).toBe('eski');
    expect(fs.existsSync(f('alt/yeni.ts'))).toBe(false);
    await expect(undoCheckpoint('r1', async () => true)).rejects.toThrow(/kaydı yok/);
  });

  it('dosya yazılmadıysa ya da aynı içeriğe döndüyse geri alma noktası yok', async () => {
    beginCheckpoint('r2');
    expect(await endCheckpoint()).toBeNull();
    fs.writeFileSync(f('b.txt'), 'ayni', 'utf8');
    beginCheckpoint('r3');
    await write('b.txt', 'farkli');
    await write('b.txt', 'ayni');
    expect(await endCheckpoint()).toBeNull();
  });

  it('kullanıcı dosyayı sonradan değiştirdiyse onay ister; vazgeçerse dokunmaz', async () => {
    fs.writeFileSync(f('c.txt'), 'eski', 'utf8');
    beginCheckpoint('r4');
    await write('c.txt', 'ajan');
    await endCheckpoint();
    fs.writeFileSync(f('c.txt'), 'kullanıcı ekledi', 'utf8');
    let asked: string[] = [];
    const r = await undoCheckpoint('r4', async (changed) => { asked = changed; return false; });
    expect(asked).toEqual([f('c.txt')]);
    expect(r).toEqual({ restored: [], cancelled: true });
    expect(fs.readFileSync(f('c.txt'), 'utf8')).toBe('kullanıcı ekledi');
    const r2 = await undoCheckpoint('r4', async () => true); // kayıt durur, onaylanınca geri alınır
    expect(r2.restored).toEqual([f('c.txt')]);
    expect(fs.readFileSync(f('c.txt'), 'utf8')).toBe('eski');
  });

  it('başlamamış kayıtta yazım izlenmez', async () => {
    await write('d.txt', 'x');
    expect(await endCheckpoint()).toBeNull();
  });
});
