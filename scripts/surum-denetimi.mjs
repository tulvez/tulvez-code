#!/usr/bin/env node
/**
 * Sürüm bilgisi denetimi — yayından ÖNCE çalışır (publish.yml) ve testlerde de koşar.
 *
 * Kural: bir sürüm, bilgileri hazırlanmadan yayınlanmaz. Yeni sürüm için üç yer birlikte güncellenir:
 *   1. package.json → "version"
 *   2. CHANGELOG.md → "## <sürüm>" bölümü (ayrıntılı değişiklik listesi)
 *   3. surumler.json → EN ÜSTE yeni kayıt: tarih, tür, TR/EN başlık ve kısa özet
 * surumler.json releases.tulvez.com, download.tulvez.com ve docs.tulvez.com/tulvez-code'un tek kaynağıdır:
 * sürüm Marketplace'te doğrulanınca sunucudaki bekçi bu dosyayı (etiketteki haliyle) alıp siteleri derler.
 *
 * Kullanım: node scripts/surum-denetimi.mjs [etiket]   (ör. v0.3.1; verilmezse package.json sürümü)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TURLER = ['ekleme', 'duzeltme', 'degisiklik']

const surumSirasi = (a, b) => {
  const pa = a.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  const pb = b.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue
    if (pa[i] === undefined) return 1 // 1.0.0 > 1.0.0-beta
    if (pb[i] === undefined) return -1
    return typeof pa[i] === 'number' && typeof pb[i] === 'number' ? pa[i] - pb[i] : String(pa[i]).localeCompare(String(pb[i]))
  }
  return 0
}

export function denetle(kok = KOK, etiket) {
  const hatalar = []
  const pkg = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8'))
  const surum = pkg.version
  if (etiket && etiket.replace(/^v/, '') !== surum) {
    hatalar.push(`Etiket (${etiket}) ile package.json sürümü (${surum}) aynı değil.`)
  }

  const changelog = fs.readFileSync(path.join(kok, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n')
  const bolum = new RegExp(`^## ${surum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(changelog)
  if (!bolum) hatalar.push(`CHANGELOG.md içinde "## ${surum}" bölümü yok.`)
  else if (!bolum[1].trim()) hatalar.push(`CHANGELOG.md "## ${surum}" bölümü boş.`)
  // Geliştirirken "## Yayınlanmadı" serbest; yayın anında (etiketle) kalmamalı
  if (etiket && /^## Yayınlanmadı/m.test(changelog)) hatalar.push('CHANGELOG.md’de "## Yayınlanmadı" bölümü kalmış: sürüm numarasıyla adlandır.')

  let liste = []
  try {
    liste = JSON.parse(fs.readFileSync(path.join(kok, 'surumler.json'), 'utf8'))
    if (!Array.isArray(liste)) throw new Error('dizi değil')
  } catch (err) {
    hatalar.push(`surumler.json okunamadı: ${err.message}`)
  }
  const dolu = (v, en, fazla) => typeof v === 'string' && v.trim().length >= en && v.trim().length <= fazla
  liste.forEach((k, i) => {
    const ad = `surumler.json[${i}]${k?.surum ? ` (${k.surum})` : ''}`
    if (!k || typeof k !== 'object') { hatalar.push(`${ad}: kayıt nesne değil.`); return }
    if (!dolu(k.surum, 1, 40)) hatalar.push(`${ad}: "surum" eksik.`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k.tarih ?? '') || Number.isNaN(Date.parse(k.tarih))) hatalar.push(`${ad}: "tarih" YYYY-AA-GG olmalı.`)
    if (!TURLER.includes(k.tur)) hatalar.push(`${ad}: "tur" şunlardan biri olmalı: ${TURLER.join(', ')}.`)
    for (const dil of ['tr', 'en']) {
      if (!dolu(k.baslik?.[dil], 3, 90)) hatalar.push(`${ad}: "baslik.${dil}" 3–90 karakter olmalı.`)
      if (!dolu(k.ozet?.[dil], 40, 700)) hatalar.push(`${ad}: "ozet.${dil}" 40–700 karakter olmalı (kullanıcının göreceği kısa açıklama).`)
    }
    if (i > 0 && liste[i - 1]?.surum && k.surum && surumSirasi(liste[i - 1].surum, k.surum) <= 0) {
      hatalar.push(`${ad}: kayıtlar yeniden eskiye sıralı olmalı (${liste[i - 1].surum} önce).`)
    }
  })
  if (liste.length && liste[0]?.surum !== surum) {
    hatalar.push(`surumler.json'ın en üst kaydı ${surum} olmalı (şu an ${liste[0]?.surum ?? 'yok'}). Yeni sürümün başlığını ve özetini en üste ekle.`)
  }
  return { surum, hatalar }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { surum, hatalar } = denetle(KOK, process.argv[2])
  if (hatalar.length) {
    console.error(`✗ ${surum} sürümünün bilgileri hazır değil — yayın durduruldu:\n${hatalar.map((h) => `  • ${h}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`✓ ${surum} sürüm bilgileri hazır (package.json, CHANGELOG.md, surumler.json).`)
}
