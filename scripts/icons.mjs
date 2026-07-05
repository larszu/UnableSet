/**
 * Erzeugt die PWA-Icons headless (Chromium-Screenshot einer Inline-SVG).
 * Einmalig ausführen, PNGs werden committet:  node scripts/icons.mjs
 */

import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'packages', 'client', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const html = (size) => `<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f1b33"/>
      <stop offset="1" stop-color="#0a0f1a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <rect x="24" y="24" width="464" height="464" rx="80" fill="none" stroke="#1b2740" stroke-width="8"/>
  <!-- U -->
  <path d="M 150 130 v 150 a 80 80 0 0 0 160 0 v -150" fill="none"
        stroke="#38bdf8" stroke-width="52" stroke-linecap="round"/>
  <!-- Play-Pfeil -->
  <path d="M 300 300 l 92 62 l -92 62 z" fill="#34d399"/>
</svg></body></html>`;

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});

for (const size of [512, 192, 180]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html(size));
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await page.screenshot({ path: join(OUT, name), omitBackground: false });
  await page.close();
  console.log(`✓ ${name}`);
}

await browser.close();
