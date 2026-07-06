import { describe, expect, it } from 'vitest';
import { setlistFromText, setlistToText } from './setlistText.js';
import type { Setlist, Song } from './types.js';

function makeSong(id: string, title: string): Song {
  return {
    id,
    title,
    tags: [],
    startBeat: 0,
    lengthBeats: 1,
    sections: [],
    autoplayNext: true,
    stopAfter: false,
  };
}

const songs = [makeSong('a', 'Alpha'), makeSong('b', 'Beta Song'), makeSong('c', 'Gamma')];

describe('setlistFromText', () => {
  it('eine Zeile = ein Song, Match case-insensitiv', () => {
    const result = setlistFromText('alpha\nBETA SONG\n', songs);
    expect(result.entries.map((e) => e.songId)).toEqual(['a', 'b']);
    expect(result.unmatched).toEqual([]);
  });

  it('derselbe Song darf mehrfach vorkommen — eindeutige entryIds', () => {
    const result = setlistFromText('Alpha\nGamma\nAlpha', songs);
    expect(result.entries.map((e) => e.songId)).toEqual(['a', 'c', 'a']);
    expect(new Set(result.entries.map((e) => e.entryId)).size).toBe(3);
  });

  it('unbekannte Zeilen landen in unmatched', () => {
    const result = setlistFromText('Alpha\nGibtEsNicht', songs);
    expect(result.entries).toHaveLength(1);
    expect(result.unmatched).toEqual(['GibtEsNicht']);
  });

  it('# Zeilen definieren Sets', () => {
    const result = setlistFromText('# Set 1\nAlpha\n# Set 2\nBeta Song', songs);
    expect(result.entries[0].setGroup).toBe('Set 1');
    expect(result.entries[1].setGroup).toBe('Set 2');
  });

  it('Leerzeilen werden ignoriert', () => {
    const result = setlistFromText('\nAlpha\n\n\nGamma\n', songs);
    expect(result.entries).toHaveLength(2);
  });
});

describe('setlistToText', () => {
  it('exportiert Titel zeilenweise mit Set-Trennern (Roundtrip)', () => {
    const setlist: Setlist = {
      id: 'x',
      name: 'Test',
      entries: [
        { entryId: '1', songId: 'a', setGroup: 'Set 1' },
        { entryId: '2', songId: 'b', setGroup: 'Set 1' },
        { entryId: '3', songId: 'c', setGroup: 'Set 2' },
      ],
    };
    const text = setlistToText(setlist, songs);
    expect(text).toBe('# Set 1\nAlpha\nBeta Song\n# Set 2\nGamma');

    const reimported = setlistFromText(text, songs);
    expect(reimported.entries.map((e) => e.songId)).toEqual(['a', 'b', 'c']);
    expect(reimported.entries[2].setGroup).toBe('Set 2');
  });

  it('Override-Titel gewinnt beim Export', () => {
    const setlist: Setlist = {
      id: 'x',
      name: 'Test',
      entries: [{ entryId: '1', songId: 'a', overrides: { title: 'Alpha (Akustik)' } }],
    };
    expect(setlistToText(setlist, songs)).toBe('Alpha (Akustik)');
  });
});
