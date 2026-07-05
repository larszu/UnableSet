/**
 * Parser für die Locator-Notation (Cue-Point-Namen), siehe PROTOCOL.md §3.
 *
 * Unterstützt: `Titel {Beschreibung}`, `*ignorieren`, `SONG END`, `STOP`
 * sowie generische `+FLAG` / `+FLAG:VALUE`-Tokens (z. B. `+LOOP:4`, `+STOP`).
 */

export type LocatorKind = 'song' | 'songEnd' | 'stop' | 'ignored';

export interface ParsedLocator {
  kind: LocatorKind;
  /** Songtitel ohne Beschreibung und Flags (nur bei kind === 'song'). */
  title: string;
  description?: string;
  /** Flag-Tokens, Keys uppercased; wertlose Flags haben `true`. */
  flags: Map<string, string | true>;
}

const DESCRIPTION_RE = /\{([^}]*)\}/g;
const FLAG_RE = /(?:^|\s)\+([A-Za-z][\w-]*)(?::([^\s]+))?/g;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseLocatorName(rawName: string): ParsedLocator {
  const name = rawName.trim();
  const flags = new Map<string, string | true>();

  if (name.startsWith('*')) {
    return { kind: 'ignored', title: '', flags };
  }

  // Beschreibung(en) extrahieren und aus dem Titel entfernen
  let description: string | undefined;
  const withoutDescription = name.replace(DESCRIPTION_RE, (_match, inner: string) => {
    const text = collapseWhitespace(inner);
    if (text.length > 0) {
      description = description ? `${description} ${text}` : text;
    }
    return ' ';
  });

  // Flags extrahieren und aus dem Titel entfernen
  const withoutFlags = withoutDescription.replace(
    FLAG_RE,
    (_match, key: string, value: string | undefined) => {
      flags.set(key.toUpperCase(), value ?? true);
      return ' ';
    },
  );

  const title = collapseWhitespace(withoutFlags);
  const upper = title.toUpperCase();

  if (upper === 'SONG END') {
    return { kind: 'songEnd', title: '', flags };
  }
  if (upper === 'STOP') {
    return { kind: 'stop', title: '', flags };
  }
  if (title.length === 0) {
    // Locator bestand nur aus Beschreibung/Flags — kein sinnvoller Song
    return { kind: 'ignored', title: '', flags };
  }

  const result: ParsedLocator = { kind: 'song', title, flags };
  if (description !== undefined) result.description = description;
  return result;
}
