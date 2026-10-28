// CLI derlemesi: tek ESM dosyası (cli/dist/tulvez.mjs) + pi-tui'nin yerel yardımcıları (cli/dist/native).
// Kullanım: node cli/build.mjs [--watch]
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dist = path.join(here, 'dist');

// Yerel yardımcılar (Windows'ta fare/VT girdisi, pano) JS dosyasına gömülemez; yanında durur.
// pi-tui onları paketlenmiş dosyanın klasöründe "native/<platform>/prebuilds/…" altında arar.
function copyNative() {
  const src = path.join(root, 'node_modules', '@earendil-works', 'pi-tui', 'native');
  const dst = path.join(dist, 'native');
  fs.rmSync(dst, { recursive: true, force: true });
  for (const platform of ['win32', 'darwin', 'linux']) {
    const prebuilds = path.join(src, platform, 'prebuilds');
    if (fs.existsSync(prebuilds)) fs.cpSync(prebuilds, path.join(dst, platform, 'prebuilds'), { recursive: true });
  }
}

const options = {
  entryPoints: [path.join(here, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(dist, 'tulvez.mjs'),
  // Paketlenen CommonJS bağımlılıkları require/__dirname bekler
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __tzRequire } from 'node:module';",
      "import { fileURLToPath as __tzPath } from 'node:url';",
      'const require = __tzRequire(import.meta.url);',
      'const __filename = __tzPath(import.meta.url);',
      "const __dirname = __tzPath(new URL('.', import.meta.url));",
    ].join('\n'),
  },
  logLevel: 'info',
};

fs.mkdirSync(dist, { recursive: true });
copyNative();
if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
