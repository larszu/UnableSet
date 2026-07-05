/**
 * Baut aus Ableton-Cue-Points die Song-Liste (Setlist-Rohmaterial).
 * Die Live-Session wird dabei nie verändert — reine Lese-Interpretation.
 */

import type { CuePoint, Song } from '@unableset/shared';
import { parseLocatorName } from './locatorParser.js';

/**
 * Stabile Song-ID aus Titel + Startposition. Position gehört dazu, damit
 * gleichnamige Locators (z. B. zwei „Interlude") unterscheidbar bleiben.
 */
export function songIdFor(title: string, startBeat: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'song'}@${startBeat}`;
}

export function buildSongsFromCuePoints(
  cuePoints: CuePoint[],
  songLengthBeats?: number,
): Song[] {
  const sorted = [...cuePoints].sort((a, b) => a.timeBeats - b.timeBeats);
  const songs: Song[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i];
    const parsed = parseLocatorName(cue.name);

    if (parsed.kind === 'songEnd' || parsed.kind === 'stop') {
      // Marker beendet den laufenden Song an dieser Position
      const previous = songs[songs.length - 1];
      if (previous && previous.startBeat + previous.lengthBeats >= cue.timeBeats) {
        previous.lengthBeats = Math.max(0, cue.timeBeats - previous.startBeat);
        if (parsed.kind === 'stop') previous.stopAfter = true;
      }
      continue;
    }
    if (parsed.kind === 'ignored') continue;

    // Songende: nächster nicht-ignorierter Locator oder Arrangement-Ende
    let endBeat = songLengthBeats ?? cue.timeBeats;
    for (let j = i + 1; j < sorted.length; j++) {
      if (parseLocatorName(sorted[j].name).kind !== 'ignored') {
        endBeat = sorted[j].timeBeats;
        break;
      }
    }

    const song: Song = {
      id: songIdFor(parsed.title, cue.timeBeats),
      title: parsed.title,
      tags: [],
      startBeat: cue.timeBeats,
      lengthBeats: Math.max(0, endBeat - cue.timeBeats),
      sections: [],
      autoplayNext: true,
      stopAfter: parsed.flags.has('STOP'),
    };
    if (parsed.description !== undefined) song.description = parsed.description;
    songs.push(song);
  }

  return songs;
}
