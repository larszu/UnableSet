/**
 * BandHelper-/CSV-Import: extrahiert Songtitel aus einem CSV-Export
 * (BandHelper „Songs/Setlists exportieren" oder beliebige Tabelle mit einer
 * Titel-Spalte). Titel werden anschließend wie beim Plaintext-Import gegen
 * die Ableton-Songs gematcht.
 */

const TITLE_HEADERS = ['title', 'song title', 'name', 'song', 'titel', 'songname'];

/** Eine CSV-Zeile in Felder zerlegen (Anführungszeichen + "" -Escapes). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === ';') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * CSV → Songtitel-Liste. Mit Header-Zeile wird die Titel-Spalte erkannt
 * (title/name/song/…); ohne erkennbaren Header zählt die erste Spalte.
 */
export function parseSongTitlesFromCsv(csv: string): string[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((field) => field.toLowerCase());
  let titleColumn = header.findIndex((field) => TITLE_HEADERS.includes(field));
  let startRow = 1;
  if (titleColumn < 0) {
    titleColumn = 0;
    startRow = 0; // keine Header-Zeile erkannt — alles sind Daten
  }

  const titles: string[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const title = parseCsvLine(lines[i])[titleColumn];
    if (title) titles.push(title);
  }
  return titles;
}
