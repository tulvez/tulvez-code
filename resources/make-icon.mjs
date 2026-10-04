// resources/make-icon.mjs
// Çalıştır: node resources/make-icon.mjs
// Gereksinim: npm install sharp  (sadece bu script için)

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 128x128 SVG — #242424 arka plan, ortada yeşil T ikonu
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="22" fill="#242424"/>
  <path fill="#D7F36B" d="M24 32h80v16H72v48H56V48H24z"/>
</svg>`;

sharp(Buffer.from(svg))
  .png()
  .toFile(path.join(__dirname, 'icon.png'))
  .then(() => console.log('✅ resources/icon.png oluşturuldu (128x128)'))
  .catch((e) => console.error('❌', e));
