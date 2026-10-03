import * as fs from 'fs';
import * as vscode from 'vscode';

export const SKILLS_FILE = 'code_skills.md';

export interface Skill {
  name: string;
  text: string;
}

const DEFAULT_TEMPLATE = `# Tulvez Code Skills

Bu dosya, çalışma alanındaki Tulvez Code ajanının kimliğini ve yeteneklerini tanımlar.
Tulvez Code bu dosyayı her istekte okur. Dosyayı düzenleyerek ajanın karakterini, kurallarını ve
uzmanlıklarını kendi projenize göre özelleştirebilirsiniz. Dosya silinirse Tulvez Code
varsayılan kimliği kullanır.

## Kimlik

Sen Tulvez Code, bu çalışma alanında çalışan bir yazılım mühendisi asistanısın.
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

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function skillsFileUri(): vscode.Uri | undefined {
  const root = workspaceRoot();
  return root ? vscode.Uri.joinPath(vscode.Uri.file(root), SKILLS_FILE) : undefined;
}

export function skillsFileExists(): boolean {
  const uri = skillsFileUri();
  if (!uri) return false;
  return fs.existsSync(uri.fsPath);
}

export function createSkillsTemplate(): boolean {
  const uri = skillsFileUri();
  if (!uri || fs.existsSync(uri.fsPath)) return false;
  fs.writeFileSync(uri.fsPath, DEFAULT_TEMPLATE, 'utf8');
  return true;
}

export function readSkillsFile(): string {
  const uri = skillsFileUri();
  if (!uri) return '';
  try {
    return fs.readFileSync(uri.fsPath, 'utf8');
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

export function parseSkills(): Skill[] {
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
    skills.push({ name: m[1].trim(), text: skillsBlock.slice(start, end).trim() });
  });
  return skills;
}