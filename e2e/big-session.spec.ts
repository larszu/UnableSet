/**
 * Skalierungs-E2E: 400 Songs / 2000 Cue Points (eigener Stack auf separaten
 * Ports, Szenario „big"). Prüft, dass Parsing, Snapshot, Rendering und Suche
 * bei großen Sessions funktionieren, plus PWA-Grundlagen.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';

const HTTP = 'http://127.0.0.1:4495';
let stack: ChildProcess | null = null;

test.beforeAll(async () => {
  stack = spawn(process.execPath, ['scripts/e2e-stack.mjs'], {
    env: {
      ...process.env,
      E2E_HTTP_PORT: '4495',
      E2E_OSC_PORT: '18060',
      E2E_OSC_LISTEN_PORT: '18061',
      E2E_SCENARIO: 'big',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${HTTP}/api/health`);
      if (res.ok) return;
    } catch {
      // noch nicht bereit
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Big-Session-Stack wurde nicht bereit');
});

test.afterAll(() => {
  stack?.kill('SIGTERM');
});

test('2000 Cue Points: Songs geparst, UI rendert, Suche funktioniert', async ({ page }) => {
  // Host hat alle 400 Songs inkl. Sections geparst
  await expect
    .poll(
      async () => {
        const state = await (await fetch(`${HTTP}/api/state`)).json();
        return state.songs.length;
      },
      { timeout: 15_000 },
    )
    .toBe(400);

  const state = await (await fetch(`${HTTP}/api/state`)).json();
  expect(state.songs[0].sections).toHaveLength(4);
  expect(state.setlists[0].entries).toHaveLength(400);

  await page.goto(HTTP);
  await page.getByTestId('tab-setlist').click();
  await expect(page.getByTestId('entry-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('entry-0')).toContainText('Song 001');

  // Suche in der Bibliothek filtert schnell auf einen Treffer
  await page.getByTestId('library-search').fill('Song 399');
  await expect(page.getByTestId('song-library')).toContainText('Song 399');
  await expect(page.getByTestId('song-library').getByRole('listitem')).toHaveCount(1);
});

test('PWA: Manifest, Icons und Service Worker werden ausgeliefert', async ({ page }) => {
  const manifest = await (await fetch(`${HTTP}/manifest.webmanifest`)).json();
  expect(manifest.name).toBe('UnableSet');
  expect(manifest.display).toBe('standalone');

  expect((await fetch(`${HTTP}/icons/icon-192.png`)).status).toBe(200);
  expect((await fetch(`${HTTP}/sw.js`)).status).toBe(200);

  // SW registriert sich im Browser (127.0.0.1 ist Secure Context)
  await page.goto(HTTP);
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const registration = await navigator.serviceWorker.ready;
    return registration.active ? 'active' : 'pending';
  });
  expect(['active', 'pending']).toContain(registered);
});
