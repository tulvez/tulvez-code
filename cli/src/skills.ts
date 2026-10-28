import * as fs from 'fs';
import * as path from 'path';
import { githubOwner, localSkills, setSkillsRoot, syncOrgSkills } from '../../src/services/orgSkills';
import { registryBase } from '../../src/services/skillsRegistry';

/** Eklentiyle aynı aralık: GitHub becerileri 12 saatte bir eşitlenir. */
const SYNC_EVERY_MS = 12 * 60 * 60 * 1000;
const STAMP = '.son-esitleme';

/** Beceriler CLI ayar klasöründe durur (eklentininkinden ayrı). */
export function initSkills(configDir: string): string {
  const root = path.join(configDir, 'skills');
  setSkillsRoot(root);
  return root;
}

/**
 * Süresi geçtiyse ya da hiç beceri yoksa arka planda eşitler. Yalnız etkileşimli oturumda çağrılır:
 * tek istekte süreç hemen kapanır ve yazma yarıda kalabilir. Hata oturumu durdurmaz.
 */
export async function syncSkillsIfStale(root: string, now = Date.now()): Promise<string[]> {
  const owner = githubOwner(registryBase());
  if (!owner) return [];
  let last = 0;
  try { last = fs.statSync(path.join(root, STAMP)).mtimeMs; } catch { /* hiç eşitlenmedi */ }
  if (now - last < SYNC_EVERY_MS && localSkills(root).length > 0) return [];
  const result = await syncOrgSkills(owner, root, []);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, STAMP), new Date(now).toISOString(), 'utf8');
  return result.updated;
}
