/**
 * MIDI-Learn-Test: der MidiManager lernt aus rohen Events, ersetzt bestehende
 * Mappings derselben Aktion und persistiert die Konfiguration. Ohne Hardware
 * (kein @julusian/midi) — handleEvent wird direkt gefüttert.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MidiState } from '@unableset/shared';
import { MidiManager, mappingFromEvent } from './midiMapping.js';

let dir: string;

afterEach(async () => {
  // Kurz warten, damit fire-and-forget-Writes fertig sind, dann mit Retries löschen
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
});

async function makeManager(): Promise<{
  manager: MidiManager;
  actions: string[];
  states: MidiState[];
}> {
  dir = await fs.mkdtemp(join(tmpdir(), 'unableset-midi-'));
  const actions: string[] = [];
  const states: MidiState[] = [];
  const manager = new MidiManager(
    dir,
    (action) => actions.push(action),
    (state) => states.push(state),
  );
  await manager.start(); // ohne @julusian/midi → nur editierbar
  return { manager, actions, states };
}

describe('mappingFromEvent', () => {
  it('noteOn → noteOn-Mapping', () => {
    expect(mappingFromEvent({ status: 0x90, data1: 60, data2: 100 }, 'play')).toEqual({
      event: 'noteOn',
      channel: 0,
      data1: 60,
      action: 'play',
    });
  });

  it('cc → cc-Mapping', () => {
    expect(mappingFromEvent({ status: 0xb2, data1: 64, data2: 127 }, 'stop')).toEqual({
      event: 'cc',
      channel: 2,
      data1: 64,
      action: 'stop',
    });
  });

  it('noteOff (velocity 0) ist kein Trigger', () => {
    expect(mappingFromEvent({ status: 0x90, data1: 60, data2: 0 }, 'play')).toBeNull();
  });
});

describe('MidiManager Learn-Flow', () => {
  it('lernt ein Mapping und feuert es danach', async () => {
    const { manager, actions } = await makeManager();

    manager.learn('nextSong');
    expect(manager.getState().learning).toBe('nextSong');

    // Das nächste Event wird gelernt (nicht als Aktion ausgeführt)
    manager.handleEvent({ status: 0x90, data1: 62, data2: 100 });
    expect(manager.getState().learning).toBeUndefined();
    expect(manager.getState().mappings).toContainEqual({
      event: 'noteOn',
      channel: 0,
      data1: 62,
      action: 'nextSong',
    });
    expect(actions).toEqual([]); // beim Lernen keine Aktion

    // Jetzt löst dasselbe Event die Aktion aus
    manager.handleEvent({ status: 0x90, data1: 62, data2: 100 });
    expect(actions).toEqual(['nextSong']);
  });

  it('ersetzt ein bestehendes Mapping derselben Aktion', async () => {
    const { manager } = await makeManager();
    manager.learn('play');
    manager.handleEvent({ status: 0x90, data1: 60, data2: 100 });
    manager.learn('play');
    manager.handleEvent({ status: 0x90, data1: 61, data2: 100 });

    const playMappings = manager.getState().mappings.filter((m) => m.action === 'play');
    expect(playMappings).toHaveLength(1);
    expect(playMappings[0].data1).toBe(61);
  });

  it('persistiert die Mappings (midi-map.json)', async () => {
    const { manager } = await makeManager();
    manager.learn('jumpNow');
    manager.handleEvent({ status: 0xb0, data1: 20, data2: 127 });

    // atomicWriteJson läuft fire-and-forget — auf die Datei warten
    const file = join(dir, 'midi-map.json');
    let saved: { mappings: unknown[] } | null = null;
    for (let i = 0; i < 50 && saved === null; i++) {
      try {
        saved = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    expect(saved?.mappings).toContainEqual({
      event: 'cc',
      channel: 0,
      data1: 20,
      action: 'jumpNow',
    });
  });

  it('deleteMapping entfernt einen Eintrag', async () => {
    const { manager } = await makeManager();
    manager.learn('play');
    manager.handleEvent({ status: 0x90, data1: 60, data2: 100 });
    expect(manager.getState().mappings).toHaveLength(1);
    manager.deleteMapping(0);
    expect(manager.getState().mappings).toHaveLength(0);
  });
});
