/**
 * Headless-E2E der kritischen Bühnen-Flows gegen den kompletten Stack
 * (AbletonOSC-Simulator + Host + gebauter Client). Serial, da die Tests
 * denselben Host-State teilen.
 */

import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('Verbinden: Snapshot zeigt Songs und Status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('current-song-title')).toHaveText(/Neonlicht/);

  await page.getByTestId('tab-setlist').click();
  await expect(page.getByTestId('entry-list')).toBeVisible();
  await expect(page.getByTestId('entry-0')).toContainText('Neonlicht');
  await expect(page.getByTestId('entry-1')).toContainText('Sturmfahrt');
  await expect(page.getByTestId('entry-2')).toContainText('Herzschlag');
  await expect(page.getByTestId('entry-3')).toContainText('Zugabe: Feuerwerk');
  // STOP-Marker aus den Locators ist als Badge sichtbar
  await expect(page.getByTestId('entry-1')).toContainText('STOP');
});

test('Play/Stop: Transport läuft und stoppt', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-performance').click();

  await page.getByTestId('btn-play').click();
  await expect(page.getByText('PLAYING')).toBeVisible();

  const barBeat = page.getByTestId('bar-beat');
  const before = await barBeat.textContent();
  await expect(async () => {
    expect(await barBeat.textContent()).not.toBe(before);
  }).toPass({ timeout: 5000 });

  await page.getByTestId('btn-stop').click();
  await expect(page.getByText('STOPPED')).toBeVisible();
});

test('Queue bei stehendem Transport springt sofort', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-stop').click();

  await page.getByTestId('tab-setlist').click();
  await page.getByTestId('entry-queue-2').click(); // Herzschlag (startBeat 288)

  await page.getByTestId('tab-performance').click();
  await expect(page.getByTestId('current-song-title')).toHaveText(/Herzschlag/);
});

test('Queue bei laufendem Playback: Banner + sofortiger Sprung per Button', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-play').click();
  await expect(page.getByText('PLAYING')).toBeVisible();

  await page.getByTestId('tab-setlist').click();
  await page.getByTestId('entry-queue-3').click(); // Zugabe (startBeat 448)
  await expect(page.getByTestId('queue-banner')).toBeVisible();
  await expect(page.getByTestId('queue-banner')).toContainText('Zugabe');

  await page.getByTestId('btn-jump-now').click();
  await page.getByTestId('tab-performance').click();
  await expect(page.getByTestId('current-song-title')).toHaveText(/Zugabe/);
  await page.getByTestId('btn-stop').click();
});

test('Sections: Fortschrittsbalken zeigt Section-Labels', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-stop').click();
  await page.getByTestId('tab-setlist').click();
  await page.getByTestId('entry-queue-0').click(); // Neonlicht mit 5 Sections

  await page.getByTestId('tab-performance').click();
  const progress = page.getByTestId('song-progress');
  await expect(progress).toContainText('Intro');
  await expect(progress).toContainText('Chorus');
});

test('Mixer: Tracks sichtbar, Mute togglet', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-mixer').click();
  await page.getByTestId('mixer-refresh').click();
  await expect(page.getByTestId('track-0')).toContainText('Click');
  await expect(page.getByTestId('track-5')).toContainText('Timecode');

  const muteButton = page.getByTestId('track-1').getByRole('button', { name: 'M' });
  await muteButton.click();
  await page.getByTestId('mixer-refresh').click();
  await expect(muteButton).toHaveClass(/stage-danger/, { timeout: 5000 });
});

test('Sperre: Steuerung deaktiviert, Ansicht bleibt', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('lock-toggle').click();
  await expect(page.getByText('Ansicht gesperrt')).toBeVisible();
  await page.getByTestId('tab-setlist').click();
  await expect(page.getByTestId('entry-list')).toBeVisible();
  // Kein Queue-Button klickbar
  await expect(page.getByTestId('entry-queue-0')).toBeDisabled();
  await page.getByTestId('lock-toggle').click();
  await expect(page.getByTestId('entry-queue-0')).toBeEnabled();
});

test('Setlist-Reorder überlebt einen Reload (Persistenz + Snapshot)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-setlist').click();

  // Eigene Setlist anlegen (Default ist an die Locator-Reihenfolge gebunden)
  page.on('dialog', (dialog) => void dialog.accept('E2E Show'));
  await page.getByRole('button', { name: '+ Neu (Kopie)' }).click();
  await expect(page.getByTestId('setlist-select')).toContainText('E2E Show');

  await page.getByTestId('entry-down-0').click();
  await expect(page.getByTestId('entry-0')).toContainText('Sturmfahrt');
  await expect(page.getByTestId('entry-1')).toContainText('Neonlicht');

  await page.reload();
  await page.getByTestId('tab-setlist').click();
  await expect(page.getByTestId('entry-0')).toContainText('Sturmfahrt');
});
