/**
 * Jump-/Quantisierungs-Logik als reine Funktionen — das Herzstück von M2.
 * Der Host rechnet die Sprunggrenzen aus Position + Taktart selbst (Weg A
 * liefert keine Beat-Callbacks); alles hier ist deshalb unit-getestet.
 */

import { quarterBeatsPerBar } from './beats.js';
import type { JumpMode, Section, Song } from './types.js';

/** Nächste Taktgrenze strikt nach der Position. */
export function nextBarBoundary(positionBeats: number, timeSig: [number, number]): number {
  const perBar = quarterBeatsPerBar(timeSig);
  const bars = Math.floor(positionBeats / perBar + 1e-9);
  const boundary = (bars + 1) * perBar;
  // Position exakt auf einer Taktgrenze: die nächste ist einen Takt weiter
  return boundary <= positionBeats + 1e-9 ? boundary + perBar : boundary;
}

/** Section, in der eine Position liegt. */
export function sectionAtBeat(song: Song, positionBeats: number): Section | undefined {
  return song.sections.find(
    (section) =>
      positionBeats >= section.startBeat &&
      positionBeats < section.startBeat + section.lengthBeats,
  );
}

/**
 * Beat-Position, an der ein gequeueter Sprung ausgeführt werden soll.
 * `null` = nicht automatisch springen (manual) bzw. sofort (wenn gestoppt).
 */
export function jumpBoundaryFor(
  mode: JumpMode,
  positionBeats: number,
  timeSig: [number, number],
  currentSong: Song | undefined,
): number | null {
  const songEnd = currentSong ? currentSong.startBeat + currentSong.lengthBeats : null;
  const section = currentSong ? sectionAtBeat(currentSong, positionBeats) : undefined;
  const sectionEnd = section ? section.startBeat + section.lengthBeats : null;

  switch (mode) {
    case 'manual':
      return null;
    case 'quantized': {
      const bar = nextBarBoundary(positionBeats, timeSig);
      // nie über das Songende hinaus warten
      return songEnd !== null ? Math.min(bar, songEnd) : bar;
    }
    case 'endOfSection':
      return sectionEnd ?? songEnd ?? nextBarBoundary(positionBeats, timeSig);
    case 'endOfSong':
      return songEnd ?? nextBarBoundary(positionBeats, timeSig);
    case 'dynamic':
      // nächstgelegene musikalisch sinnvolle Grenze: Section-Ende, sonst Taktgrenze
      return sectionEnd ?? (songEnd !== null
        ? Math.min(nextBarBoundary(positionBeats, timeSig), songEnd)
        : nextBarBoundary(positionBeats, timeSig));
  }
}

/**
 * Hat die Wiedergabe zwischen zwei Polling-Ticks eine Grenze überschritten?
 * (prev < boundary <= now, tolerant gegen Float-Rundung)
 */
export function crossedBoundary(
  prevPositionBeats: number,
  positionBeats: number,
  boundaryBeats: number,
): boolean {
  return prevPositionBeats < boundaryBeats - 1e-9 && positionBeats >= boundaryBeats - 1e-9;
}

/** Ziel-Position eines Sprungs inkl. optionalem Pre-Roll (Count-in in Takten). */
export function jumpTargetBeats(
  song: Song,
  section: Section | undefined,
  preRollBars: number,
  timeSig: [number, number],
): number {
  const target = section ? section.startBeat : song.startBeat;
  if (preRollBars <= 0) return target;
  const perBar = quarterBeatsPerBar(timeSig);
  // Pre-Roll nie vor den Songanfang (bei Section-Sprüngen innerhalb des Songs)
  return Math.max(song.startBeat, target - preRollBars * perBar);
}
