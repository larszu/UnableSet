import { describe, expect, it } from 'vitest';
import { beatsToBarBeat, beatsToSeconds, findSongAtBeat, quarterBeatsPerBar } from './beats.js';
import type { Song } from './types.js';

describe('quarterBeatsPerBar', () => {
  it('4/4 hat 4 Viertel pro Takt', () => {
    expect(quarterBeatsPerBar([4, 4])).toBe(4);
  });

  it('6/8 hat 3 Viertel pro Takt', () => {
    expect(quarterBeatsPerBar([6, 8])).toBe(3);
  });

  it('3/4 hat 3 Viertel pro Takt', () => {
    expect(quarterBeatsPerBar([3, 4])).toBe(3);
  });

  it('ungültige Taktart fällt auf 4 zurück', () => {
    expect(quarterBeatsPerBar([0, 4])).toBe(4);
  });
});

describe('beatsToBarBeat', () => {
  it('Beat 0 ist Takt 1, Schlag 1', () => {
    expect(beatsToBarBeat(0, [4, 4])).toEqual({ bar: 1, beat: 1 });
  });

  it('Beat 4 in 4/4 ist Takt 2, Schlag 1', () => {
    expect(beatsToBarBeat(4, [4, 4])).toEqual({ bar: 2, beat: 1 });
  });

  it('Beat 5.5 in 4/4 ist Takt 2, Schlag 2', () => {
    expect(beatsToBarBeat(5.5, [4, 4])).toEqual({ bar: 2, beat: 2 });
  });

  it('6/8: zählt Achtel als Schläge', () => {
    // 1 Viertel = 2 Achtel-Zählzeiten → Position 1.0 = Schlag 3
    expect(beatsToBarBeat(1, [6, 8])).toEqual({ bar: 1, beat: 3 });
    // 3 Viertel = ein voller 6/8-Takt
    expect(beatsToBarBeat(3, [6, 8])).toEqual({ bar: 2, beat: 1 });
  });

  it('negative Position wird auf Takt 1, Schlag 1 geklemmt', () => {
    expect(beatsToBarBeat(-2, [4, 4])).toEqual({ bar: 1, beat: 1 });
  });
});

describe('beatsToSeconds', () => {
  it('120 BPM: 120 Beats = 60 Sekunden', () => {
    expect(beatsToSeconds(120, 120)).toBe(60);
  });

  it('BPM 0 ergibt 0 statt Division durch Null', () => {
    expect(beatsToSeconds(64, 0)).toBe(0);
  });
});

function makeSong(id: string, startBeat: number, lengthBeats: number): Song {
  return {
    id,
    title: id,
    tags: [],
    startBeat,
    lengthBeats,
    sections: [],
    autoplayNext: true,
    stopAfter: false,
  };
}

describe('findSongAtBeat', () => {
  const songs = [makeSong('a', 0, 64), makeSong('b', 64, 56), makeSong('c', 128, 72)];

  it('findet den Song an einer Position', () => {
    expect(findSongAtBeat(songs, 0)?.id).toBe('a');
    expect(findSongAtBeat(songs, 63.9)?.id).toBe('a');
    expect(findSongAtBeat(songs, 64)?.id).toBe('b');
    expect(findSongAtBeat(songs, 130)?.id).toBe('c');
  });

  it('Lücke zwischen Songs ergibt undefined', () => {
    expect(findSongAtBeat(songs, 124)).toBeUndefined();
  });

  it('nach dem letzten Song ergibt undefined', () => {
    expect(findSongAtBeat(songs, 500)).toBeUndefined();
  });
});
