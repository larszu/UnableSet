import { describe, expect, it } from 'vitest';
import {
  crossedBoundary,
  jumpBoundaryFor,
  jumpTargetBeats,
  nextBarBoundary,
  sectionAtBeat,
} from './jump.js';
import type { Section, Song } from './types.js';

function makeSong(startBeat: number, lengthBeats: number, sections: Section[] = []): Song {
  return {
    id: 's',
    title: 'Song',
    tags: [],
    startBeat,
    lengthBeats,
    sections,
    autoplayNext: true,
    stopAfter: false,
  };
}

function makeSection(id: string, startBeat: number, lengthBeats: number): Section {
  return { id, name: id, startBeat, lengthBeats };
}

describe('nextBarBoundary', () => {
  it('mitten im Takt: nächste Taktgrenze', () => {
    expect(nextBarBoundary(5.5, [4, 4])).toBe(8);
    expect(nextBarBoundary(0.1, [4, 4])).toBe(4);
  });

  it('exakt auf Taktgrenze: eine weiter', () => {
    expect(nextBarBoundary(8, [4, 4])).toBe(12);
    expect(nextBarBoundary(0, [4, 4])).toBe(4);
  });

  it('6/8 (3 Viertel pro Takt)', () => {
    expect(nextBarBoundary(4, [6, 8])).toBe(6);
  });
});

describe('sectionAtBeat', () => {
  const song = makeSong(0, 64, [makeSection('a', 0, 16), makeSection('b', 16, 48)]);

  it('findet die Section', () => {
    expect(sectionAtBeat(song, 0)?.id).toBe('a');
    expect(sectionAtBeat(song, 15.9)?.id).toBe('a');
    expect(sectionAtBeat(song, 16)?.id).toBe('b');
  });

  it('außerhalb: undefined', () => {
    expect(sectionAtBeat(song, 64)).toBeUndefined();
  });
});

describe('jumpBoundaryFor', () => {
  const song = makeSong(0, 64, [makeSection('a', 0, 16), makeSection('b', 16, 48)]);

  it('manual: nie automatisch', () => {
    expect(jumpBoundaryFor('manual', 5, [4, 4], song)).toBeNull();
  });

  it('quantized: nächste Taktgrenze', () => {
    expect(jumpBoundaryFor('quantized', 5, [4, 4], song)).toBe(8);
  });

  it('quantized: wartet nie über das Songende hinaus', () => {
    expect(jumpBoundaryFor('quantized', 62.5, [4, 4], song)).toBe(64);
  });

  it('endOfSection: Ende der aktuellen Section', () => {
    expect(jumpBoundaryFor('endOfSection', 5, [4, 4], song)).toBe(16);
    expect(jumpBoundaryFor('endOfSection', 20, [4, 4], song)).toBe(64);
  });

  it('endOfSection ohne Sections: Songende', () => {
    expect(jumpBoundaryFor('endOfSection', 5, [4, 4], makeSong(0, 32))).toBe(32);
  });

  it('endOfSong: Songende', () => {
    expect(jumpBoundaryFor('endOfSong', 5, [4, 4], song)).toBe(64);
  });

  it('dynamic: Section-Ende, sonst Taktgrenze', () => {
    expect(jumpBoundaryFor('dynamic', 5, [4, 4], song)).toBe(16);
    expect(jumpBoundaryFor('dynamic', 5, [4, 4], makeSong(0, 32))).toBe(8);
  });

  it('ohne aktuellen Song: Taktgrenze als Fallback', () => {
    expect(jumpBoundaryFor('quantized', 5, [4, 4], undefined)).toBe(8);
  });
});

describe('crossedBoundary', () => {
  it('erkennt Überschreitung zwischen zwei Ticks', () => {
    expect(crossedBoundary(7.8, 8.1, 8)).toBe(true);
    expect(crossedBoundary(7.8, 7.95, 8)).toBe(false);
    expect(crossedBoundary(8.0, 8.4, 8)).toBe(false);
  });

  it('tolerant bei Float-Rundung (Tick landet exakt auf der Grenze)', () => {
    expect(crossedBoundary(7.9, 8.0, 8)).toBe(true);
  });
});

describe('jumpTargetBeats', () => {
  const song = makeSong(32, 64, [makeSection('a', 32, 16), makeSection('b', 48, 48)]);

  it('Song-Sprung ohne Pre-Roll: Songanfang', () => {
    expect(jumpTargetBeats(song, undefined, 0, [4, 4])).toBe(32);
  });

  it('Section-Sprung: Section-Anfang', () => {
    expect(jumpTargetBeats(song, song.sections[1], 0, [4, 4])).toBe(48);
  });

  it('Pre-Roll: n Takte vor der Section', () => {
    expect(jumpTargetBeats(song, song.sections[1], 2, [4, 4])).toBe(40);
  });

  it('Pre-Roll nie vor den Songanfang', () => {
    expect(jumpTargetBeats(song, song.sections[0], 4, [4, 4])).toBe(32);
  });
});
