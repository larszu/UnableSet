/**
 * Beat-/Takt-Mathematik. Ableton liefert Positionen in Viertelnoten-Beats
 * (`current_song_time`), unabhängig von der Taktart.
 */

import type { Song } from './types.js';

/** Viertelnoten-Beats pro Takt für eine Taktart, z. B. 4/4 → 4, 6/8 → 3. */
export function quarterBeatsPerBar(timeSig: [number, number]): number {
  const [numerator, denominator] = timeSig;
  if (numerator <= 0 || denominator <= 0) return 4;
  return numerator * (4 / denominator);
}

export interface BarBeat {
  bar: number;
  beat: number;
}

/**
 * Absolute Beat-Position → Takt/Schlag (beide 1-basiert, wie in Live).
 * `beat` zählt in Zählzeiten der Taktart (bei 6/8 also 1..6).
 */
export function beatsToBarBeat(positionBeats: number, timeSig: [number, number]): BarBeat {
  const perBar = quarterBeatsPerBar(timeSig);
  const safePosition = Math.max(0, positionBeats);
  const bar = Math.floor(safePosition / perBar) + 1;
  const beatInBarQuarter = safePosition - (bar - 1) * perBar;
  const quarterPerCount = 4 / timeSig[1];
  const beat = Math.floor(beatInBarQuarter / quarterPerCount) + 1;
  return { bar, beat };
}

/** Dauer in Sekunden für eine Beat-Strecke bei gegebenem Tempo. */
export function beatsToSeconds(beats: number, bpm: number): number {
  if (bpm <= 0) return 0;
  return (beats / bpm) * 60;
}

/** Findet den Song, in dem eine Beat-Position liegt (Lücken → undefined). */
export function findSongAtBeat(songs: Song[], positionBeats: number): Song | undefined {
  return songs.find(
    (song) =>
      positionBeats >= song.startBeat && positionBeats < song.startBeat + song.lengthBeats,
  );
}
