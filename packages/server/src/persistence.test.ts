import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWriteJson, readJsonWithBackup } from './util/atomicWrite.js';
import { Persistence } from './persistence.js';

let dir: string;

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function makeDir(): Promise<string> {
  dir = await fs.mkdtemp(join(tmpdir(), 'unableset-test-'));
  return dir;
}

describe('atomicWriteJson', () => {
  it('schreibt und rotiert .bak', async () => {
    const base = await makeDir();
    const file = join(base, 'data.json');

    await atomicWriteJson(file, { v: 1 });
    await atomicWriteJson(file, { v: 2 });

    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 2 });
    expect(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))).toEqual({ v: 1 });
  });

  it('readJsonWithBackup fällt bei kaputter Hauptdatei aufs Backup zurück', async () => {
    const base = await makeDir();
    const file = join(base, 'data.json');
    await atomicWriteJson(file, { v: 1 });
    await atomicWriteJson(file, { v: 2 });
    await fs.writeFile(file, '{kaputt', 'utf8');

    expect(await readJsonWithBackup(file)).toEqual({ v: 1 });
  });

  it('readJsonWithBackup liefert null, wenn nichts existiert', async () => {
    const base = await makeDir();
    expect(await readJsonWithBackup(join(base, 'missing.json'))).toBeNull();
  });
});

describe('Persistence', () => {
  it('Setlists-Roundtrip (debounced, flush erzwingt Schreiben)', async () => {
    const base = await makeDir();
    const persistence = new Persistence(base);

    persistence.saveSetlists({
      activeSetlistId: 'x',
      setlists: [{ id: 'x', name: 'Gig', entries: [] }],
    });
    await persistence.flush();

    const loaded = await persistence.loadSetlists();
    expect(loaded?.activeSetlistId).toBe('x');
    expect(loaded?.setlists[0].name).toBe('Gig');
  });

  it('Settings-Roundtrip', async () => {
    const base = await makeDir();
    const persistence = new Persistence(base);

    persistence.saveSettings({
      jumpMode: 'endOfSong',
      safeMode: true,
      preRollBars: 2,
      hidePlayed: false,
      clockRules: [{ id: 'r1', at: '20:00', action: 'play', enabled: true }],
    });
    await persistence.flush();

    const loaded = await persistence.loadSettings();
    expect(loaded?.jumpMode).toBe('endOfSong');
    expect(loaded?.clockRules?.[0].at).toBe('20:00');
  });
});
