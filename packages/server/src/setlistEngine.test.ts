import { beforeEach, describe, expect, it } from 'vitest';
import type { Section, Setlist, Song } from '@unableset/shared';
import { SetlistEngine } from './setlistEngine.js';
import { FakeBridge } from './testUtil.js';

function makeSection(id: string, startBeat: number, lengthBeats: number): Section {
  return { id, name: id, startBeat, lengthBeats };
}

function makeSong(id: string, startBeat: number, lengthBeats: number, extra: Partial<Song> = {}): Song {
  return {
    id,
    title: id.toUpperCase(),
    tags: [],
    startBeat,
    lengthBeats,
    sections: [],
    autoplayNext: true,
    stopAfter: false,
    ...extra,
  };
}

// Arrangement: A[0,32) B[32,32) — Lücke — C[80,32)
const songA = makeSong('a', 0, 32, {
  sections: [makeSection('a#0', 0, 16), makeSection('a#1', 16, 16)],
});
const songB = makeSong('b', 32, 32);
const songC = makeSong('c', 80, 32);

// Setlist-Reihenfolge weicht vom Arrangement ab: A → C → B
const setlist: Setlist = {
  id: 'test',
  name: 'Test',
  entries: [
    { entryId: 'e-a', songId: 'a' },
    { entryId: 'e-c', songId: 'c' },
    { entryId: 'e-b', songId: 'b' },
  ],
};

describe('SetlistEngine', () => {
  let bridge: FakeBridge;
  let engine: SetlistEngine;

  beforeEach(() => {
    bridge = new FakeBridge();
    engine = new SetlistEngine(bridge);
    engine.setSongs([songA, songB, songC]);
    engine.setActiveSetlist(structuredClone(setlist));
  });

  function tick(positionBeats: number, isPlaying = true): void {
    bridge.transport.isPlaying = isPlaying;
    bridge.transport.positionBeats = positionBeats;
    engine.handleTransportTick({ ...bridge.transport, timeSig: [4, 4] });
  }

  describe('Queue & Jump-Modi', () => {
    it('Queue bei stehendem Transport positioniert sofort', () => {
      engine.queue('c', 'e-c');
      expect(bridge.actions).toContain('pos:80');
      expect(engine.getState().queued).toBeUndefined();
      expect(engine.getState().currentEntryId).toBe('e-c');
    });

    it('quantized: springt an der nächsten Taktgrenze', () => {
      tick(5.0);
      engine.queue('c', 'e-c');
      expect(engine.getState().queued?.songId).toBe('c');

      tick(5.6);
      expect(bridge.actions.filter((a) => a.startsWith('pos:'))).toHaveLength(0);

      // Taktgrenze 8 überschritten → Sprung
      tick(8.1);
      expect(bridge.actions).toContain('pos:80');
      expect(engine.getState().queued).toBeUndefined();
    });

    it('endOfSong: wartet bis zum Songende', () => {
      engine.setJumpMode('endOfSong');
      tick(5.0);
      engine.queue('c', 'e-c');

      tick(8.1); // Taktgrenze — darf NICHT springen
      expect(bridge.actions.filter((a) => a.startsWith('pos:'))).toHaveLength(0);

      tick(32.1); // Songende von A
      expect(bridge.actions).toContain('pos:80');
    });

    it('endOfSection: springt am Ende der aktuellen Section', () => {
      engine.setJumpMode('endOfSection');
      tick(5.0);
      engine.queue('c', 'e-c');

      tick(15.9);
      expect(bridge.actions.filter((a) => a.startsWith('pos:'))).toHaveLength(0);

      tick(16.2); // Section a#0 endet bei 16
      expect(bridge.actions).toContain('pos:80');
    });

    it('manual: springt nie automatisch, nur per jumpNow', () => {
      engine.setJumpMode('manual');
      tick(5.0);
      engine.queue('c', 'e-c');
      tick(8.1);
      tick(32.1);
      // Songende feuert Autoplay (nächster Eintrag nach e-a ist e-c) — aber kein Queue-Jump davor
      expect(engine.getState().queued?.songId).toBe('c');

      expect(engine.jumpNow([4, 4])).toBe(true);
      expect(bridge.actions).toContain('pos:80');
    });

    it('Section-Jump mit Pre-Roll', () => {
      engine.setPreRoll(2);
      engine.queue('a', 'e-a', 'a#1'); // Section startet bei 16, Pre-Roll 2 Takte = 8 Beats
      expect(bridge.actions).toContain('pos:8');
    });
  });

  describe('Safe Mode', () => {
    it('blockiert jumpNow bei laufendem Playback', () => {
      engine.setSafeMode(true);
      tick(5.0);
      engine.queue('c', 'e-c');
      expect(engine.jumpNow([4, 4])).toBe(false);
      expect(bridge.actions.filter((a) => a.startsWith('pos:'))).toHaveLength(0);
    });

    it('erlaubt jumpNow bei gestopptem Transport', () => {
      engine.setSafeMode(true);
      tick(5.0);
      engine.queue('c', 'e-c'); // Queue läuft — dann stoppen
      tick(6.0, false);
      expect(engine.jumpNow([4, 4])).toBe(true);
    });
  });

  describe('Autoplay über die Setlist-Reihenfolge', () => {
    it('Songende: springt zum nächsten Setlist-Eintrag (nicht Arrangement)', () => {
      tick(31.0); // in A, currentEntry = e-a
      expect(engine.getState().currentEntryId).toBe('e-a');

      tick(32.4); // A-Ende überschritten → nächster Eintrag ist e-c (Song C bei 80)
      expect(bridge.actions).toContain('pos:80');
      expect(engine.getState().currentEntryId).toBe('e-c');
      expect(engine.getState().playedEntryIds).toContain('e-a');
    });

    it('läuft natürlich weiter, wenn der nächste Eintrag der Arrangement-Nachbar ist', () => {
      engine.setActiveSetlist({
        id: 'natural',
        name: 'Natural',
        entries: [
          { entryId: 'n-a', songId: 'a' },
          { entryId: 'n-b', songId: 'b' },
        ],
      });
      tick(31.0);
      tick(32.4); // B beginnt exakt bei 32 → kein Teleport nötig
      expect(bridge.actions.filter((a) => a.startsWith('pos:'))).toHaveLength(0);
      expect(engine.getState().currentEntryId).toBe('n-b');
    });

    it('stopAfter: stoppt und bereitet den nächsten Song vor', () => {
      engine.setSongs([{ ...songA, stopAfter: true }, songB, songC]);
      tick(31.0);
      tick(32.4);
      expect(bridge.actions).toContain('stop');
      expect(bridge.actions).toContain('pos:80'); // nächster Eintrag e-c vorbereitet
      expect(engine.getState().currentEntryId).toBe('e-c');
    });

    it('Ende der Setlist: Stop', () => {
      engine.setActiveSetlist({
        id: 'solo',
        name: 'Solo',
        entries: [{ entryId: 's-a', songId: 'a' }],
      });
      tick(31.0);
      tick(32.4);
      expect(bridge.actions).toContain('stop');
    });

    it('skip-Override wird bei der Navigation übersprungen', () => {
      engine.setActiveSetlist({
        id: 'skip',
        name: 'Skip',
        entries: [
          { entryId: 'k-a', songId: 'a' },
          { entryId: 'k-c', songId: 'c', overrides: { skip: true } },
          { entryId: 'k-b', songId: 'b' },
        ],
      });
      tick(31.0);
      tick(32.4); // e-c ist geskippt → direkt zu B; B beginnt bei 32 → kein Teleport
      expect(engine.getState().currentEntryId).toBe('k-b');
    });
  });

  describe('Navigation', () => {
    it('nextSong/prevSong folgen der Setlist', () => {
      tick(5.0, false);
      expect(engine.getState().currentEntryId).toBe('e-a');
      engine.nextSong([4, 4]); // stehend → sofort
      expect(bridge.actions).toContain('pos:80');
      expect(engine.getState().currentEntryId).toBe('e-c');

      engine.prevSong([4, 4]);
      expect(bridge.actions).toContain('pos:0');
      expect(engine.getState().currentEntryId).toBe('e-a');
    });
  });

  describe('Section-Loop', () => {
    it('legt das Loop-Bracket um die Section und räumt beim Sprung auf', () => {
      engine.loopSection('a', 'a#1', true);
      expect(bridge.loop).toEqual({ start: 16, length: 16, enabled: true });
      expect(engine.getState().loopSectionId).toBe('a#1');

      engine.queue('c', 'e-c'); // stehend → sofortiger Sprung räumt den Loop ab
      expect(bridge.loop.enabled).toBe(false);
      expect(engine.getState().loopSectionId).toBeUndefined();
    });

    it('deaktivieren räumt den State auf', () => {
      engine.loopSection('a', 'a#1', true);
      engine.loopSection('a', 'a#1', false);
      expect(bridge.loop.enabled).toBe(false);
      expect(engine.getState().loopSectionId).toBeUndefined();
    });
  });

  describe('Played-Tracking', () => {
    it('markPlayed togglet', () => {
      engine.markPlayed('e-a', true);
      expect(engine.getState().playedEntryIds).toEqual(['e-a']);
      engine.markPlayed('e-a', false);
      expect(engine.getState().playedEntryIds).toEqual([]);
    });
  });
});
