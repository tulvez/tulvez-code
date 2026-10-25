import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { slashMenu } from '../../webview/src/lib/slashMenu';

const { importLocalSkill, importLocalSkills, exportLocalSkill, localSkills, syncOrgSkill } = await import('../services/orgSkills');
const { matchSkill } = await import('../services/skills');

const COMMANDS = [
  { cmd: '/run', hint: 'Terminal' },
  { cmd: '/review', hint: 'İnceleme' },
  { cmd: '/commit', hint: 'Commit' },
  { cmd: '/skill', hint: 'Beceri' },
];
const SKILLS = [
  { name: 'scale-engineer', description: 'Kaç kullanıcı kaldırır' },
  { name: 'test-yaz', description: 'Birim testi yazar' },
];

describe('/ menüsü', () => {
  it('"/" bütün komutları, "/re" yalnız eşleşenleri gösterir', () => {
    expect(slashMenu('/', COMMANDS, SKILLS)?.items.map((i) => i.label)).toEqual(['/run', '/review', '/commit', '/skill']);
    expect(slashMenu('/re', COMMANDS, SKILLS)?.items.map((i) => i.label)).toEqual(['/review']);
    expect(slashMenu('/xyz', COMMANDS, SKILLS)).toBeNull();
    expect(slashMenu('merhaba', COMMANDS, SKILLS)).toBeNull();
  });

  it('"/skill" ve "/skills" becerileri listeler; yazdıkça süzer', () => {
    for (const input of ['/skill', '/skills', '/skill ', '/Skills ']) {
      const m = slashMenu(input, COMMANDS, SKILLS);
      expect(m?.title).toBe('Beceriler');
      expect(m?.items.map((i) => i.label)).toEqual(['scale-engineer', 'test-yaz']);
    }
    const m = slashMenu('/skill sc', COMMANDS, SKILLS);
    expect(m?.items).toEqual([{ label: 'scale-engineer', hint: 'Kaç kullanıcı kaldırır', insert: '/skill scale-engineer ' }]);
    expect(slashMenu('/skill testi', COMMANDS, SKILLS)?.items.map((i) => i.label)).toEqual(['test-yaz']); // açıklamada arar
  });

  it('beceri seçilip boşluk konunca menü kapanır (istek yazılır)', () => {
    expect(slashMenu('/skill scale-engineer ', COMMANDS, SKILLS)).toBeNull();
    expect(slashMenu('/skill scale-engineer bu proje', COMMANDS, SKILLS)).toBeNull();
  });

  it('beceri yoksa seçilemeyen bir satır gösterir', () => {
    const m = slashMenu('/skill', COMMANDS, []);
    expect(m?.items).toHaveLength(1);
    expect(m?.items[0]).toMatchObject({ label: 'Kurulu beceri yok', disabled: true });
  });
});

describe('/skill <ad> [istek]', () => {
  const skills = [
    { name: 'scale-engineer', text: 'A', description: '' },
    { name: 'Test yaz', text: 'B', description: '' },
    { name: 'test', text: 'C', description: '' },
  ];
  it('ad ve isteği ayırır; boşluklu adda en uzun eşleşme kazanır', () => {
    expect(matchSkill(skills, 'scale-engineer')).toEqual({ skill: skills[0], request: '' });
    expect(matchSkill(skills, 'scale-engineer ücretsiz planda kaç kişi?')).toEqual({ skill: skills[0], request: 'ücretsiz planda kaç kişi?' });
    expect(matchSkill(skills, 'test yaz utils.ts için')).toEqual({ skill: skills[1], request: 'utils.ts için' });
    expect(matchSkill(skills, 'test')?.skill).toBe(skills[2]);
  });
  it('bilinmeyen ad ya da ad öneki eşleşmez', () => {
    expect(matchSkill(skills, 'yok')).toBeNull();
    expect(matchSkill(skills, 'scale')).toBeNull();
  });
});

describe('bilgisayardan yükle / indir', () => {
  let root = '';
  let work = '';
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-root-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-work-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('SKILL.md içeren klasör bütünüyle kurulur; gizli dosya ve node_modules atlanır', () => {
    const src = path.join(work, 'Benim Becerim');
    fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(src, 'node_modules', 'x'), { recursive: true });
    fs.mkdirSync(path.join(src, '.git'));
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: rapor-yaz\ndescription: Haftalık rapor yazar.\n---\n\nTalimat.\n');
    fs.writeFileSync(path.join(src, 'scripts', 'a.py'), 'print(1)\n');
    fs.writeFileSync(path.join(src, 'node_modules', 'x', 'i.js'), '');
    fs.writeFileSync(path.join(src, '.git', 'HEAD'), '');
    const skill = importLocalSkill(src, root);
    expect(skill).toMatchObject({ id: 'rapor-yaz', source: 'local', description: 'Haftalık rapor yazar.' });
    expect(fs.existsSync(path.join(root, 'rapor-yaz', 'scripts', 'a.py'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'rapor-yaz', 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'rapor-yaz', '.git'))).toBe(false);
    expect(localSkills(root)).toEqual([expect.objectContaining({ id: 'rapor-yaz', source: 'local' })]);
  });

  it('ön bilgisiz tek .md dosyası: ad dosya adından, açıklama ilk satırdan', () => {
    const file = path.join(work, 'Kod İnceleme.md');
    fs.writeFileSync(file, '# Kod incelemesi yap\n\nHata ve riskleri madde madde yaz.\n');
    const skill = importLocalSkill(file, root);
    expect(skill.id).toBe('kod-inceleme');
    expect(skill.description).toBe('Kod incelemesi yap');
    const [listed] = localSkills(root);
    expect(listed.description).toBe('Kod incelemesi yap');
    expect(fs.readFileSync(path.join(listed.dir, 'SKILL.md'), 'utf8')).toContain('Hata ve riskleri madde madde yaz.');
  });

  it('geçersiz kaynaklar reddedilir, yarım klasör kalmaz', () => {
    fs.mkdirSync(path.join(work, 'bos'));
    expect(() => importLocalSkill(path.join(work, 'bos'), root)).toThrow(/beceri dosyası/);
    fs.writeFileSync(path.join(work, 'x.txt'), 'a');
    expect(() => importLocalSkill(path.join(work, 'x.txt'), root)).toThrow(/\.md/);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('klasördeki beceri dosyası her adla olabilir; SKILL.md olarak kurulur', () => {
    const src = path.join(work, 'Rapor Becerisi');
    fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(src, 'rapor.md'), '# Haftalık rapor\n\nKısa yaz.\n');
    fs.writeFileSync(path.join(src, 'scripts', 'r.py'), '');
    const skill = importLocalSkill(src, root);
    expect(skill).toMatchObject({ id: 'rapor-becerisi', description: 'Haftalık rapor' });
    expect(fs.readdirSync(skill.dir).sort()).toEqual(['.tulvez-skill.json', 'SKILL.md', 'scripts']);
  });

  it('birden çok seçim ve koleksiyon klasörü: her .md ve her beceri klasörü ayrı beceri', () => {
    const coll = path.join(work, 'becerilerim');
    fs.mkdirSync(path.join(coll, 'derin', 'refs'), { recursive: true });
    fs.mkdirSync(path.join(coll, 'bos-alt'));
    fs.writeFileSync(path.join(coll, 'commit-mesaji.md'), 'Commit mesajı yazar.\n');
    fs.writeFileSync(path.join(coll, 'Çeviri.md'), '---\nname: ceviri\ndescription: Metni çevirir.\n---\nx\n');
    fs.writeFileSync(path.join(coll, 'derin', 'SKILL.md'), '---\nname: derin\ndescription: Derin inceleme.\n---\nx\n');
    fs.writeFileSync(path.join(coll, 'derin', 'refs', 'a.md'), 'ek');
    const tek = path.join(work, 'tek.md');
    fs.writeFileSync(tek, 'Tek başına beceri.\n');
    const r = importLocalSkills([coll, tek, path.join(work, 'yok.md')], root);
    expect(r.imported.map((s) => s.id).sort()).toEqual(['ceviri', 'commit-mesaji', 'derin', 'tek']);
    expect(r.errors).toEqual(['yok.md okunamadı']);
    expect(fs.existsSync(path.join(root, 'derin', 'refs', 'a.md'))).toBe(true);
    expect(localSkills(root).map((s) => s.id)).toEqual(['ceviri', 'commit-mesaji', 'derin', 'tek']);
  });

  it('içinde beceri olmayan klasör hata olarak bildirilir, diğerleri yüklenir', () => {
    fs.mkdirSync(path.join(work, 'resimler'));
    fs.writeFileSync(path.join(work, 'resimler', 'a.png'), '');
    fs.writeFileSync(path.join(work, 'iyi.md'), 'İyi beceri');
    const r = importLocalSkills([path.join(work, 'resimler'), path.join(work, 'iyi.md')], root);
    expect(r.imported.map((s) => s.id)).toEqual(['iyi']);
    expect(r.errors).toEqual(['resimler: klasörde beceri bulunamadı']);
  });

  it('indir: beceri seçilen klasöre kopyalanır, iç kayıt dosyası gitmez; aynı ad varsa üstüne yazmaz', () => {
    const src = path.join(work, 'b');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: b-beceri\ndescription: d\n---\nx\n');
    importLocalSkill(src, root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-out-'));
    const dest = exportLocalSkill(root, 'b-beceri', out);
    expect(dest).toBe(path.join(out, 'b-beceri'));
    expect(fs.readdirSync(dest)).toEqual(['SKILL.md']);
    expect(() => exportLocalSkill(root, 'b-beceri', out)).toThrow(/zaten var/);
    expect(() => exportLocalSkill(root, 'yok', out)).toThrow(/kurulu değil/);
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('bilgisayardan yüklenen beceri aynı adlı GitHub becerisiyle ezilmez', async () => {
    const src = path.join(work, 'c');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: scale-engineer\ndescription: benim sürümüm\n---\nx\n');
    importLocalSkill(src, root);
    // Ağa hiç gitmeden atlanır
    const updated = await syncOrgSkill({ id: 'scale-engineer', name: 'scale-engineer', description: '', repo: 'tulvez/scale-engineer', branch: 'main' }, root);
    expect(updated).toBe(false);
    expect(localSkills(root)[0]).toMatchObject({ description: 'benim sürümüm', source: 'local' });
  });
});
