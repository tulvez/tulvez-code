import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { setWorkspaceRoot } from './setup';

let tmpRoot = '';

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tulvez-tools-'));
  setWorkspaceRoot(tmpRoot);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const { executeTool, TOOL_DEFINITIONS } = await import('../services/tools');

describe('araç tanımları', () => {
  it('her araç adı, açıklaması ve şeması var', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.schema).toBeDefined();
    }
  });

  it('araç adları benzersiz', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('terminal komutu onay ister, salt-okunur araçlar istemez', () => {
    const run = TOOL_DEFINITIONS.find((t) => t.name === 'run_command');
    expect(run?.requiresApproval).toBe(true);
    expect(TOOL_DEFINITIONS.find((t) => t.name === 'read_file')?.requiresApproval).toBe(false);
  });

  it('ask modu için salt-okunur araçlar işaretli', () => {
    for (const tool of TOOL_DEFINITIONS) {
      if (tool.name === 'write_file' || tool.name === 'edit_file' || tool.name === 'replace_in_file'
        || tool.name === 'run_command' || tool.name === 'run_in_background' || tool.name === 'stop_background') {
        expect(tool.readOnly, `${tool.name} salt-okunur olmamalı`).toBe(false);
      } else {
        expect(tool.readOnly, `${tool.name} salt-okunur olmalı`).toBe(true);
      }
    }
  });
});

describe('read_file', () => {
  it('satır numarasıyla okur', async () => {
    await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'satir1\nsatir2', 'utf8');
    const out = await executeTool('read_file', { path: 'a.txt' }, false);
    expect(out).toContain('1| satir1');
    expect(out).toContain('2| satir2');
  });

  it('olmayan dosyada hata döner, çökmez', async () => {
    const out = await executeTool('read_file', { path: 'yok.txt' }, false);
    expect(out).toContain('Araç hatası');
  });
});

describe('write_file ve okuma zinciri', () => {
  it('yazar ve sonra okunabilir', async () => {
    const out = await executeTool('write_file', { path: 'yeni/klasor/x.ts', content: 'export const a = 1;\n' }, false);
    expect(out).toContain('Yazıldı');
    const read = await executeTool('read_file', { path: 'yeni/klasor/x.ts' }, false);
    expect(read).toContain('export const a = 1;');
  });
});

describe('replace_in_file güvenliği', () => {
  it('bulunmayan metin için net hata verir', async () => {
    await fs.writeFile(path.join(tmpRoot, 'b.txt'), 'merhaba dunya', 'utf8');
    const out = await executeTool('replace_in_file', {
      path: 'b.txt', old_string: 'bulunmayan', new_string: 'x',
    }, false);
    expect(out).toContain('bulunamadı');
  });

  it('birden çok eşleşmede reddeder (kör düzenleme koruması)', async () => {
    await fs.writeFile(path.join(tmpRoot, 'c.txt'), 'test\ntest\ntest', 'utf8');
    const out = await executeTool('replace_in_file', {
      path: 'c.txt', old_string: 'test', new_string: 'x',
    }, false);
    expect(out).toContain('3 yerde geçiyor');
  });

  it('tekil eşleşmede değiştirir', async () => {
    await fs.writeFile(path.join(tmpRoot, 'd.txt'), 'ilk\nson\n', 'utf8');
    const out = await executeTool('replace_in_file', {
      path: 'd.txt', old_string: 'son', new_string: 'yeni',
    }, false);
    expect(out).toContain('Düzenlendi');
    const read = await executeTool('read_file', { path: 'd.txt' }, false);
    expect(read).toContain('yeni');
  });
});

describe('grep_files', () => {
  it('eşleşmeleri dosya:satır olarak döner', async () => {
    await fs.writeFile(path.join(tmpRoot, 'x.ts'), 'const foo = 1;\nconst bar = 2;\n', 'utf8');
    const out = await executeTool('grep_files', { pattern: 'const foo' }, false);
    expect(out).toContain('x.ts:1');
  });

  it('geçersiz regex çökmez', async () => {
    const out = await executeTool('grep_files', { pattern: '([' }, false);
    expect(out).toContain('geçersiz regex');
  });

  it('eşleşme yoksa bilgi verir', async () => {
    await fs.writeFile(path.join(tmpRoot, 'y.ts'), 'zzz', 'utf8');
    const out = await executeTool('grep_files', { pattern: 'bulunamayacak-bir-desen' }, false);
    expect(out).toContain('Eşleşme bulunamadı');
  });
});

describe('run_command güvenliği', () => {
  it('izin kapalıyken çalıştırmaz', async () => {
    const out = await executeTool('run_command', { command: 'echo merhaba' }, false);
    expect(out).toContain('kapalı');
  });

  it('izin açıkken çalıştırır', async () => {
    const out = await executeTool('run_command', { command: 'echo merhaba' }, true);
    expect(out).toContain('merhaba');
  });
});

describe('list_dir', () => {
  it('ağacı listeler', async () => {
    await fs.mkdir(path.join(tmpRoot, 'alt'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'alt', 'iç.txt'), 'x', 'utf8');
    const out = await executeTool('list_dir', { directory: '.', depth: 2 }, false);
    expect(out).toContain('alt/');
    expect(out).toContain('iç.txt');
  });
});