import * as fs from 'fs';
import * as path from 'path';
import { host } from './host';
import { installedSkills } from './skillsRegistry';
import { getSkillsRoot, localSkills, skillBody } from './orgSkills';

export const SKILLS_FILE = 'code_skills.md';

export interface Skill {
  name: string;
  text: string;
  /** Seçim listesinde görünen kısa açıklama */
  description: string;
}

/** Talimatın ilk dolu satırı (başlık işaretleri atılır), kısaltılmış. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? '';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

const DEFAULT_TEMPLATE = `# Tulvez Code Skills

Bu dosya, çalışma alanındaki Tulvez Code ajanının kimliğini ve yeteneklerini tanımlar.
Tulvez Code bu dosyayı her istekte okur. Dosyayı düzenleyerek ajanın karakterini, kurallarını ve
uzmanlıklarını kendi projenize göre özelleştirebilirsiniz. Dosya silinirse Tulvez Code
varsayılan kimliği kullanır.

## Kimlik

Adın Tulvez Code; bu çalışma alanında çalışan bir yazılım mühendisi asistanısın.
Kendini başka bir ürün adıyla tanıtma; her zaman Tulvez Code olarak davran.

## Kurallar

- Bu depodaki konvansiyonlara uy (bkz. AGENTS.md)
- Değişiklik yapmadan önce ilgili dosyayı oku
- Yanıtları Türkçe ve kısa tut

## Skills

Aşağıdaki başlıklar (## Başlık) slash komutu olarak kullanılabilir:
\`/skill <başlık>\` yazarak o skill'in talimatlarını çalıştırabilirsin.
Örnek:

### test-yaz

Proje için birim testleri yaz. Önce mevcut test altyapısını incele, aynı stili kullan,
kapsamı dar tut ve çalıştır.
`;

export function skillsFilePath(): string | undefined {
  const root = host().workspaceRoot();
  return root ? path.join(root, SKILLS_FILE) : undefined;
}

export function skillsFileExists(): boolean {
  const file = skillsFilePath();
  if (!file) return false;
  return fs.existsSync(file);
}

export function createSkillsTemplate(): boolean {
  const file = skillsFilePath();
  if (!file || fs.existsSync(file)) return false;
  fs.writeFileSync(file, DEFAULT_TEMPLATE, 'utf8');
  return true;
}

export function readSkillsFile(): string {
  const file = skillsFilePath();
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Kimlik + kurallar bölümlerini döndürür (## Skills başlığı hariç). */
export function getInstructions(): string {
  const content = readSkillsFile();
  if (!content.trim()) return '';
  const withoutSkills = content.split(/^##\s+Skills\s*$/m)[0].trim();
  return withoutSkills;
}

/** code_skills.md içindeki skill'ler + depodan kurulanlar (.tulvez/skills/*.md) + GitHub becerileri. */
export function parseSkills(): Skill[] {
  const installed = installedSkills().map((s) => ({ name: s.id, text: s.text, description: firstLine(s.text) }));
  const org = localSkills(getSkillsRoot()).flatMap((s) => {
    try {
      const body = skillBody(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'));
      return [{ name: s.id, text: `${body}\n\n(Becerinin klasörü: ${s.dir} — göreli yollar buna göredir.)`, description: s.description }];
    } catch {
      return [];
    }
  });
  return [...parseFileSkills(), ...installed, ...org];
}

function parseFileSkills(): Skill[] {
  const content = readSkillsFile();
  if (!content) return [];
  const skillsBlock = content.split(/^##\s+Skills\s*$/m)[1];
  if (!skillsBlock) return [];
  const skills: Skill[] = [];
  const re = /^###\s+(.+)$/gm;
  const matches = [...skillsBlock.matchAll(re)];
  matches.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? skillsBlock.length) : skillsBlock.length;
    const text = skillsBlock.slice(start, end).trim();
    skills.push({ name: m[1].trim(), text, description: firstLine(text) });
  });
  return skills;
}
/**
 * "/skill <ad> [istek]" argümanını çözer: en uzun eşleşen beceri adı (adlarda boşluk olabilir),
 * kalan metin kullanıcının isteğidir. Eşleşme yoksa null.
 */
export function matchSkill(skills: Skill[], arg: string): { skill: Skill; request: string } | null {
  const text = arg.trim();
  const lower = text.toLowerCase();
  const hits = skills
    .filter((s) => {
      const n = s.name.toLowerCase();
      return lower === n || lower.startsWith(`${n} `);
    })
    .sort((a, b) => b.name.length - a.name.length);
  if (!hits[0]) return null;
  return { skill: hits[0], request: text.slice(hits[0].name.length).trim() };
}
