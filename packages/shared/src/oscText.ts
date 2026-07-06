/**
 * Zeilen-Notation für OSC-Nachrichten (Editor „OSC bei Songstart"):
 * eine Zeile = eine Nachricht, z. B. `/light/preset 3 1.5 warm`.
 * Zahlen werden als Zahl gesendet, alles andere als String.
 */

import type { OscArgValue, OscMessage } from './types.js';

export function parseOscLine(line: string): OscMessage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return null;
  const [address, ...rawArgs] = trimmed.split(/\s+/);
  if (address.length < 2) return null;
  const args: OscArgValue[] = rawArgs.map((raw) => {
    const num = Number(raw);
    return Number.isFinite(num) && raw !== '' ? num : raw;
  });
  return args.length > 0 ? { address, args } : { address };
}

/** Mehrzeiliger Text → Nachrichten; ungültige Zeilen werden übersprungen. */
export function parseOscLines(text: string): OscMessage[] {
  return text
    .split(/\r?\n/)
    .map(parseOscLine)
    .filter((message): message is OscMessage => message !== null);
}

export function oscMessagesToText(messages: OscMessage[]): string {
  return messages
    .map((message) =>
      [message.address, ...(message.args ?? []).map(String)].join(' '),
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// OSC-Out-Feed des Hosts (Floor-Displays, Licht/Video — herstellerneutral)
// ---------------------------------------------------------------------------

export const OSC_OUT = {
  /** [index (int, 0-basiert), titel (string)] beim Songwechsel */
  song: '/unableset/out/song',
  /** [titel (string)] — nächster Setlist-Eintrag */
  next: '/unableset/out/next',
  /** [name (string)] beim Section-Wechsel */
  section: '/unableset/out/section',
  /** [0|1] bei Play/Stop */
  playing: '/unableset/out/playing',
} as const;

/** "host:port,host2:port2" → Zielliste (ungültige Einträge werden verworfen). */
export function parseHostPortList(value: string): { address: string; port: number }[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const colon = item.lastIndexOf(':');
      if (colon <= 0) return null;
      const address = item.slice(0, colon);
      const port = Number(item.slice(colon + 1));
      if (!Number.isInteger(port) || port <= 0 || port >= 65536) return null;
      return { address, port };
    })
    .filter((target): target is { address: string; port: number } => target !== null);
}
