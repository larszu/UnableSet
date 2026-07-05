/**
 * MIDI-Mapping für Hardware-Controller (Fußschalter etc.).
 *
 * Der Matcher ist eine reine, getestete Funktion. Die Hardware-Anbindung
 * lädt `@julusian/midi` dynamisch: Ist das Modul nicht installiert (z. B.
 * Headless-CI ohne ALSA), bleibt MIDI einfach deaktiviert — der Host läuft
 * unverändert weiter. Aktivieren: `pnpm --filter @unableset/server add @julusian/midi`.
 *
 * Konfiguration: <data-dir>/midi-map.json, z. B.
 * { "input": "MC6", "mappings": [
 *   { "event": "noteOn", "channel": 0, "data1": 60, "action": "play" } ] }
 */

import { join } from 'node:path';
import { readJsonWithBackup } from './util/atomicWrite.js';

export type RemoteAction =
  | 'play'
  | 'stop'
  | 'continue'
  | 'nextSong'
  | 'prevSong'
  | 'jumpNow';

export interface MidiMappingEntry {
  event: 'noteOn' | 'cc' | 'programChange';
  channel: number;
  data1: number;
  /** Bei cc: nur auslösen, wenn der Wert ≥ Schwelle ist (Default 64). */
  threshold?: number;
  action: RemoteAction;
}

export interface MidiConfig {
  /** Substring des Input-Port-Namens; ohne Angabe: erster Port. */
  input?: string;
  mappings: MidiMappingEntry[];
}

/** Rohes 3-Byte-MIDI-Event. */
export interface RawMidiEvent {
  status: number;
  data1: number;
  data2: number;
}

/** Reiner Matcher: MIDI-Event → Aktion (oder null). */
export function matchMidiMapping(
  mappings: MidiMappingEntry[],
  event: RawMidiEvent,
): RemoteAction | null {
  const type = event.status & 0xf0;
  const channel = event.status & 0x0f;
  for (const mapping of mappings) {
    if (mapping.channel !== channel || mapping.data1 !== event.data1) continue;
    switch (mapping.event) {
      case 'noteOn':
        if (type === 0x90 && event.data2 > 0) return mapping.action;
        break;
      case 'cc':
        if (type === 0xb0 && event.data2 >= (mapping.threshold ?? 64)) return mapping.action;
        break;
      case 'programChange':
        if (type === 0xc0) return mapping.action;
        break;
    }
  }
  return null;
}

export async function loadMidiConfig(dataDir: string): Promise<MidiConfig | null> {
  const config = await readJsonWithBackup<MidiConfig>(join(dataDir, 'midi-map.json'));
  if (!config || !Array.isArray(config.mappings)) return null;
  return config;
}

/**
 * Startet die MIDI-Hardware-Anbindung, wenn Modul + Konfiguration vorhanden
 * sind. Gibt eine Stop-Funktion zurück (no-op wenn deaktiviert).
 */
export async function startMidiInput(
  dataDir: string,
  onAction: (action: RemoteAction) => void,
  log: (message: string) => void,
): Promise<() => void> {
  const config = await loadMidiConfig(dataDir);
  if (!config || config.mappings.length === 0) {
    return () => {};
  }

  let midiModule: unknown;
  try {
    midiModule = await import('@julusian/midi' as string);
  } catch {
    log('MIDI-Mapping konfiguriert, aber @julusian/midi ist nicht installiert — MIDI deaktiviert');
    return () => {};
  }

  try {
    const { Input } = midiModule as {
      Input: new () => {
        getPortCount(): number;
        getPortName(index: number): string;
        openPort(index: number): void;
        closePort(): void;
        on(event: 'message', cb: (delta: number, message: number[]) => void): void;
      };
    };
    const input = new Input();
    const count = input.getPortCount();
    let portIndex = -1;
    for (let i = 0; i < count; i++) {
      const name = input.getPortName(i);
      if (!config.input || name.toLowerCase().includes(config.input.toLowerCase())) {
        portIndex = i;
        break;
      }
    }
    if (portIndex < 0) {
      log(`Kein passender MIDI-Input gefunden (${count} Ports)`);
      return () => {};
    }
    input.on('message', (_delta, message) => {
      const [status = 0, data1 = 0, data2 = 0] = message;
      const action = matchMidiMapping(config.mappings, { status, data1, data2 });
      if (action) onAction(action);
    });
    input.openPort(portIndex);
    log(`MIDI-Input aktiv: ${input.getPortName(portIndex)}`);
    return () => input.closePort();
  } catch (error) {
    log(`MIDI-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    return () => {};
  }
}
