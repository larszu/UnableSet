/**
 * Baut aus Ableton-Cue-Points die Song-Liste inkl. Sections.
 * Die Live-Session wird dabei nie verändert — reine Lese-Interpretation.
 */

import type { CuePoint, Section, Song } from '@unableset/shared';
import { parseLocatorName, type ParsedLocator } from './locatorParser.js';

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

function sectionLoopFromFlags(flags: Map<string, string | true>): Section['loop'] {
  if (!flags.has('LOOP')) return undefined;
  const value = flags.get('LOOP');
  const count = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return {
    enabled: false,
    count: Number.isFinite(count) && count > 0 ? count : 'infinite',
    mode: flags.has('LOOPFULL') ? 'full' : 'standard',
  };
}

interface ParsedCue {
  cue: CuePoint;
  parsed: ParsedLocator;
}

export function buildSongsFromCuePoints(
  cuePoints: CuePoint[],
  songLengthBeats?: number,
): Song[] {
  const sorted: ParsedCue[] = [...cuePoints]
    .sort((a, b) => a.timeBeats - b.timeBeats)
    .map((cue) => ({ cue, parsed: parseLocatorName(cue.name) }))
    .filter(({ parsed }) => parsed.kind !== 'ignored');

  const songs: Song[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const { cue, parsed } = sorted[i];

    if (parsed.kind === 'songEnd' || parsed.kind === 'stop') {
      // Marker beendet den laufenden Song an dieser Position
      const previous = songs[songs.length - 1];
      if (previous && previous.startBeat + previous.lengthBeats >= cue.timeBeats) {
        previous.lengthBeats = Math.max(0, cue.timeBeats - previous.startBeat);
        if (parsed.kind === 'stop') previous.stopAfter = true;
      }
      continue;
    }

    if (parsed.kind === 'section') {
      // Sections werden unten dem umschließenden Song zugeordnet
      continue;
    }

    // Songende: nächster Song-/Marker-Locator oder Arrangement-Ende
    let endBeat = songLengthBeats ?? cue.timeBeats;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].parsed.kind !== 'section') {
        endBeat = sorted[j].cue.timeBeats;
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

  attachSections(songs, sorted);
  return songs;
}

/** Ordnet ">Section"-Locators den umschließenden Songs zu und berechnet Längen. */
function attachSections(songs: Song[], sorted: ParsedCue[]): void {
  for (const song of songs) {
    const songEnd = song.startBeat + song.lengthBeats;
    const sectionCues = sorted.filter(
      ({ cue, parsed }) =>
        parsed.kind === 'section' && cue.timeBeats >= song.startBeat && cue.timeBeats < songEnd,
    );
    if (sectionCues.length === 0) continue;

    const sections: Section[] = [];
    // Implizite Anfangs-Section, wenn die erste Section nicht am Songanfang liegt
    if (sectionCues[0].cue.timeBeats > song.startBeat) {
      sections.push({
        id: `${song.id}#intro`,
        name: song.title,
        startBeat: song.startBeat,
        lengthBeats: sectionCues[0].cue.timeBeats - song.startBeat,
      });
    }
    for (let i = 0; i < sectionCues.length; i++) {
      const { cue, parsed } = sectionCues[i];
      const end = i + 1 < sectionCues.length ? sectionCues[i + 1].cue.timeBeats : songEnd;
      const section: Section = {
        id: `${song.id}#${sections.length}`,
        name: parsed.title,
        startBeat: cue.timeBeats,
        lengthBeats: Math.max(0, end - cue.timeBeats),
      };
      const loop = sectionLoopFromFlags(parsed.flags);
      if (loop) section.loop = loop;
      sections.push(section);
    }
    song.sections = sections;
  }
}
