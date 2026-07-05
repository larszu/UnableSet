import { describe, expect, it } from 'vitest';
import { buildSongsFromCuePoints, songIdFor } from './songBuilder.js';
import type { CuePoint } from '@unableset/shared';

function cue(name: string, timeBeats: number): CuePoint {
  return { name, timeBeats };
}

describe('buildSongsFromCuePoints', () => {
  it('erzeugt Songs mit Länge bis zum nächsten Locator', () => {
    const songs = buildSongsFromCuePoints(
      [cue('Intro', 0), cue('Verse Song', 64), cue('Outro', 128)],
      200,
    );
    expect(songs).toHaveLength(3);
    expect(songs[0]).toMatchObject({ title: 'Intro', startBeat: 0, lengthBeats: 64 });
    expect(songs[1]).toMatchObject({ title: 'Verse Song', startBeat: 64, lengthBeats: 64 });
    expect(songs[2]).toMatchObject({ title: 'Outro', startBeat: 128, lengthBeats: 72 });
  });

  it('sortiert unsortierte Cue Points nach Zeit', () => {
    const songs = buildSongsFromCuePoints([cue('B', 64), cue('A', 0)], 100);
    expect(songs.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('SONG END beendet den Song, danach ist Lücke', () => {
    const songs = buildSongsFromCuePoints(
      [cue('A', 0), cue('SONG END', 48), cue('B', 64)],
      128,
    );
    expect(songs).toHaveLength(2);
    expect(songs[0]).toMatchObject({ title: 'A', startBeat: 0, lengthBeats: 48, stopAfter: false });
    expect(songs[1]).toMatchObject({ title: 'B', startBeat: 64, lengthBeats: 64 });
  });

  it('STOP beendet den Song und setzt stopAfter', () => {
    const songs = buildSongsFromCuePoints([cue('A', 0), cue('STOP', 48), cue('B', 64)], 128);
    expect(songs[0]).toMatchObject({ lengthBeats: 48, stopAfter: true });
    expect(songs[1]).toMatchObject({ stopAfter: false });
  });

  it('+STOP-Flag im Songnamen setzt stopAfter', () => {
    const songs = buildSongsFromCuePoints([cue('A +STOP', 0), cue('B', 64)], 128);
    expect(songs[0].stopAfter).toBe(true);
    expect(songs[0].title).toBe('A');
  });

  it('ignorierte Locators beeinflussen Songlängen nicht', () => {
    const songs = buildSongsFromCuePoints(
      [cue('A', 0), cue('*FX hier', 32), cue('B', 64)],
      128,
    );
    expect(songs).toHaveLength(2);
    expect(songs[0].lengthBeats).toBe(64);
  });

  it('Beschreibung landet am Song', () => {
    const songs = buildSongsFromCuePoints([cue('A {Halbzeit}', 0)], 64);
    expect(songs[0].description).toBe('Halbzeit');
  });

  it('letzter Song endet an der Arrangement-Länge', () => {
    const songs = buildSongsFromCuePoints([cue('Solo', 100)], 180);
    expect(songs[0].lengthBeats).toBe(80);
  });

  it('ohne Arrangement-Länge bekommt der letzte Song Länge 0 (unbekannt)', () => {
    const songs = buildSongsFromCuePoints([cue('A', 0), cue('B', 64)]);
    expect(songs[0].lengthBeats).toBe(64);
    expect(songs[1].lengthBeats).toBe(0);
  });

  it('gleichnamige Songs bekommen unterschiedliche IDs', () => {
    const songs = buildSongsFromCuePoints([cue('Interlude', 0), cue('Interlude', 64)], 128);
    expect(songs[0].id).not.toBe(songs[1].id);
  });

  it('leere Liste ergibt leere Songliste', () => {
    expect(buildSongsFromCuePoints([], 100)).toEqual([]);
  });
});

describe('songIdFor', () => {
  it('erzeugt stabile, lesbare IDs', () => {
    expect(songIdFor('Highway Star', 64)).toBe('highway-star@64');
  });

  it('fällt bei Sonderzeichen-Titeln auf "song" zurück', () => {
    expect(songIdFor('!!!', 0)).toBe('song@0');
  });
});
