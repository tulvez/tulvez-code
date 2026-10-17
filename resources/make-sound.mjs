// Tulvez Code kurulum sesi üretir. Tamamen sentetik: özgün, telifsiz, bağımlılıksız.
// Kullanım: node resources/make-sound.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'sounds');

/** Tek kanallı 16-bit PCM WAV yazar. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Zarf: hızlı açılış, yumuşak kapanış. Tıkırtı (click) oluşmasın diye 8 ms fade var. */
function envelope(i, n, attack = 0.008, release = 0.35) {
  const t = i / RATE;
  const total = n / RATE;
  const a = Math.min(1, t / attack);
  const r = total - t;
  const d = Math.min(1, Math.max(0, r / release));
  return a * d * d;
}

/** İki nota yükselen yumuşak akor: A5 -> E6. Codex benzeri "hazır" tonu. */
function chime() {
  const notes = [
    { f: 880.0, start: 0.0, dur: 0.32, gain: 0.34 },
    { f: 1318.5, start: 0.11, dur: 0.46, gain: 0.3 },
    { f: 1760.0, start: 0.22, dur: 0.55, gain: 0.16 },
  ];
  const total = 0.86;
  const n = Math.floor(total * RATE);
  const out = new Float32Array(n);
  for (const note of notes) {
    const s0 = Math.floor(note.start * RATE);
    const sn = Math.floor(note.dur * RATE);
    for (let i = 0; i < sn && s0 + i < n; i++) {
      const t = i / RATE;
      // Temel + hafif üst harmonik: metalik değil, yumuşak.
      const v =
        Math.sin(2 * Math.PI * note.f * t) * 0.82 +
        Math.sin(2 * Math.PI * note.f * 2 * t) * 0.13 +
        Math.sin(2 * Math.PI * note.f * 3 * t) * 0.05;
      out[s0 + i] += v * note.gain * envelope(i, sn);
    }
  }
  // Yumuşak low-pass: keskin üstleri keser, kulak yormaz.
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = prev * 0.42 + out[i] * 0.58;
    out[i] = prev;
  }
  // Baş/son sessizlik (kırpma payı)
  const pad = Math.floor(0.02 * RATE);
  const fin = new Float32Array(n + pad * 2);
  fin.set(out, pad);
  return fin;
}

mkdirSync(OUT, { recursive: true });
const file = join(OUT, 'tulvez-ready.wav');
const buf = wav(chime());
writeFileSync(file, buf);
console.log(`${file} yazıldı (${(buf.length / 1024).toFixed(1)} KB, ${(buf.length / 2 / RATE).toFixed(2)} sn)`);