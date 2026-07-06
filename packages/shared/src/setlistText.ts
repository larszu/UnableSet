/**
 * Plaintext-Import/-Export von Setlists: eine Zeile = ein Song.
 * Zeilen mit führendem `#` sind Set-Trenner (z. B. `# Set 2`).
 */

import type { Setlist, SetlistEntry, Song } from './types.js';

export function setlistToText(setlist: Setlist, songs: Song[]): string {
  const byId = new Map(songs.map((song) => [song.id, song]));
  const lines: string[] = [];
  let lastGroup: string | undefined;
  for (const entry of setlist.entries) {
    if (entry.setGroup !== lastGroup) {
      if (entry.setGroup) lines.push(`# ${entry.setGroup}`);
      lastGroup = entry.setGroup;
    }
    const title = entry.overrides?.title ?? byId.get(entry.songId)?.title ?? entry.songId;
    lines.push(title);
  }
  return lines.join('\n');
}

export interface SetlistTextImportResult {
  entries: SetlistEntry[];
  /** Zeilen, die keinem bekannten Song zugeordnet werden konnten. */
  unmatched: string[];
}

/**
 * Text → Setlist-Einträge. Matching gegen Songtitel, case-insensitiv.
 * Ein Song darf mehrfach vorkommen (jede Zeile ergibt einen neuen Eintrag).
 */
export function setlistFromText(text: string, songs: Song[]): SetlistTextImportResult {
  const byTitle = new Map(songs.map((song) => [song.title.trim().toLowerCase(), song]));
  const entries: SetlistEntry[] = [];
  const unmatched: string[] = [];
  let currentGroup: string | undefined;
  let counter = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      currentGroup = line.replace(/^#+\s*/, '').trim() || undefined;
      continue;
    }
    const song = byTitle.get(line.toLowerCase());
    if (!song) {
      unmatched.push(line);
      continue;
    }
    const entry: SetlistEntry = {
      entryId: `imp-${counter}-${song.id}`,
      songId: song.id,
    };
    if (currentGroup !== undefined) entry.setGroup = currentGroup;
    entries.push(entry);
    counter += 1;
  }

  return { entries, unmatched };
}
