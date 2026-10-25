#!/usr/bin/env node
/**
 * GitHub yayın notu: surumler.json'daki özet (TR/EN) + CHANGELOG.md'deki bölüm + kurulum bağlantıları.
 * publish.yml yayın kaydını bununla oluşturur. Kullanım: node scripts/surum-notu.mjs 0.3.1
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function surumNotu(surum, kok = KOK) {
  const liste = JSON.parse(fs.readFileSync(path.join(kok, 'surumler.json'), 'utf8'))
  const kayit = liste.find((k) => k.surum === surum)
  const changelog = fs.readFileSync(path.join(kok, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n')
  const kacis = surum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bolum = new RegExp(`^## ${kacis}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(changelog)?.[1].trim()
  if (!kayit && !bolum) throw new Error(`${surum} için ne surumler.json kaydı ne CHANGELOG bölümü var`)
  const parcalar = []
  if (kayit) {
    parcalar.push(`**${kayit.baslik.tr}** — ${kayit.ozet.tr}`, '', `**${kayit.baslik.en}** — ${kayit.ozet.en}`)
  }
  if (bolum) parcalar.push('', '### Değişiklikler', '', bolum)
  parcalar.push('', '---', '',
    `- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=tulvez.tulvez-code`,
    `- Bu sürümü kur / install this version: \`code --install-extension tulvez.tulvez-code@${surum}\``,
    `- VSIX: aşağıdaki dosya Marketplace'te yayınlanan paketin aynısıdır · the file below is the same package published on the Marketplace`,
    `- Belgeler / docs: https://docs.tulvez.com/tulvez-code`)
  return parcalar.join('\n')
}

export function surumBasligi(surum, kok = KOK) {
  const kayit = JSON.parse(fs.readFileSync(path.join(kok, 'surumler.json'), 'utf8')).find((k) => k.surum === surum)
  return kayit ? `Tulvez Code ${surum} — ${kayit.baslik.tr}` : `Tulvez Code ${surum}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const surum = (process.argv[2] ?? '').replace(/^v/, '')
  if (!surum) { console.error('Kullanım: node scripts/surum-notu.mjs <sürüm>'); process.exit(1) }
  if (process.argv.includes('--baslik')) console.log(surumBasligi(surum))
  else console.log(surumNotu(surum))
}
