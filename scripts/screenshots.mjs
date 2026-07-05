/**
 * Erzeugt die README-Screenshots headless: startet Simulator + Host,
 * fährt die Views mit Chromium an und legt PNGs unter docs/screenshots/ ab.
 *
 *   node scripts/screenshots.mjs
 */

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/server/package.json'));
const WebSocket = require('ws');

const HTTP_PORT = '4498';
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const OUT_DIR = join(root, 'docs', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

// --- Stack starten -----------------------------------------------------------
const stack = spawn(process.execPath, [join(root, 'scripts', 'e2e-stack.mjs')], {
  env: {
    ...process.env,
    E2E_HTTP_PORT: HTTP_PORT,
    E2E_OSC_PORT: '18090',
    E2E_OSC_LISTEN_PORT: '18091',
  },
  stdio: 'inherit',
});

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Host wurde nicht bereit');
}

function wsSend(messages) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/ws`);
    ws.on('open', () => {
      for (const message of messages) ws.send(JSON.stringify(message));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 400);
    });
    ws.on('error', reject);
  });
}

const LYRICS = [
  '.Am        F        C        G',
  'Neonlicht über der leeren Stadt',
  'wir fahren weiter, keiner wird müde',
  '',
  '.F         G        Am',
  'Und der Himmel reißt auf',
  'für einen Moment nur für uns',
  '',
  'Chorus:',
  'Wir sind das Licht in der Nacht',
  'haben den Morgen zum Leuchten gebracht',
].join('\n');

try {
  await waitForHealth();

  // Lyrics für Song 1 hinterlegen (Override am Default-Setlist-Eintrag)
  const state = await (await fetch(`${BASE}/api/state`)).json();
  const defaultSetlist = state.setlists.find((s) => s.id === 'default');
  const firstEntry = defaultSetlist.entries[0];
  await wsSend([
    {
      type: 'setlistUpdate',
      setlist: {
        ...defaultSetlist,
        entries: defaultSetlist.entries.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                overrides: { ...entry.overrides, lyrics: LYRICS, color: '#38bdf8' },
                setGroup: 'Set 1',
              }
            : index === 2
              ? { ...entry, overrides: { ...entry.overrides, color: '#a78bfa' }, setGroup: 'Set 2' }
              : index === 3
                ? { ...entry, setGroup: 'Set 2' }
                : { ...entry, setGroup: 'Set 1' },
        ),
      },
    },
    { type: 'queue', songId: firstEntry.songId, entryId: firstEntry.entryId },
    // Stabiler Queue-Banner für die Screenshots (kein Auto-Jump an der Taktgrenze)
    { type: 'setJumpMode', mode: 'endOfSong' },
  ]);

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ??
    (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));

  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT_DIR, name) });
    console.log(`✓ ${name}`);
  };

  await page.goto(BASE);

  // 1) Performance-View bei laufendem Playback (mitten in Song 1)
  await page.getByTestId('tab-performance').click();
  await page.getByTestId('btn-play').click();
  await page.waitForTimeout(2500);
  await shot('performance.png');

  // 2) Setlist mit Queue-Banner (Song 3 gecuet, Sets + Farben sichtbar)
  await page.getByTestId('tab-setlist').click();
  await page.getByTestId('entry-queue-2').click();
  await page.waitForTimeout(300);
  await shot('setlist.png');
  await page.getByTestId('btn-jump-now').click();
  await page.waitForTimeout(300);

  // 3) Lyrics-Teleprompter (zurück zu Song 1)
  await page.getByTestId('entry-queue-0').click();
  await page.getByTestId('btn-jump-now').click();
  await page.waitForTimeout(400);
  await page.getByTestId('tab-lyrics').click();
  await shot('lyrics.png');

  // 4) Mixer
  await page.getByTestId('tab-mixer').click();
  await page.getByTestId('mixer-refresh').click();
  await shot('mixer.png');

  // 5) Settings
  await page.getByTestId('tab-settings').click();
  await shot('settings.png');

  // 6) Performance auf dem Smartphone
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(BASE);
  await mobile.getByTestId('tab-performance').click();
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: join(OUT_DIR, 'performance-mobile.png') });
  console.log('✓ performance-mobile.png');

  await browser.close();
  console.log(`Screenshots liegen in ${OUT_DIR}`);
} finally {
  stack.kill('SIGTERM');
}
