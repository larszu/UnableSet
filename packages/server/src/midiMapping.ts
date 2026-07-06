/**
 * MIDI-Mapping für Hardware-Controller (Fußschalter etc.) mit Learn-Modus.
 *
 * Der Matcher ist eine reine, getestete Funktion. Die Hardware-Anbindung
 * lädt `@julusian/midi` dynamisch: Ist das Modul nicht installiert (z. B.
 * Headless-CI ohne ALSA), bleibt MIDI deaktiviert — Mappings sind trotzdem
 * sichtbar/editierbar. Aktivieren: `pnpm --filter @unableset/server add @julusian/midi`.
 *
 * Konfiguration: <data-dir>/midi-map.json
 */

import { join } from 'node:path';
import type { MidiMappingInfo, MidiState, RemoteActionName } from '@unableset/shared';
import { atomicWriteJson, readJsonWithBackup } from './util/atomicWrite.js';

export type RemoteAction = RemoteActionName;
export type MidiMappingEntry = MidiMappingInfo;

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

/** Event → Mapping-Vorlage (für den Learn-Modus). */
export function mappingFromEvent(
  event: RawMidiEvent,
  action: RemoteAction,
): MidiMappingEntry | null {
  const type = event.status & 0xf0;
  const channel = event.status & 0x0f;
  if (type === 0x90 && event.data2 > 0) {
    return { event: 'noteOn', channel, data1: event.data1, action };
  }
  if (type === 0xb0) {
    return { event: 'cc', channel, data1: event.data1, action };
  }
  if (type === 0xc0) {
    return { event: 'programChange', channel, data1: event.data1, action };
  }
  return null; // noteOff/Aftertouch etc. sind keine sinnvollen Trigger
}

interface MidiInputLike {
  getPortCount(): number;
  getPortName(index: number): string;
  openPort(index: number): void;
  closePort(): void;
  on(event: 'message', cb: (delta: number, message: number[]) => void): void;
}

/**
 * Verwaltet Mappings, Learn-Modus und (optional) die Hardware-Anbindung.
 * Broadcastet Zustandsänderungen über den onState-Callback.
 */
export class MidiManager {
  private state: MidiState = { available: false, mappings: [] };
  private config: MidiConfig = { mappings: [] };
  private input: MidiInputLike | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly onAction: (action: RemoteAction) => void,
    private readonly onState: (state: MidiState) => void,
    private readonly log: (message: string) => void = () => {},
  ) {}

  getState(): MidiState {
    return { ...this.state, mappings: [...this.state.mappings] };
  }

  private emitState(): void {
    this.state.mappings = this.config.mappings;
    this.onState(this.getState());
  }

  async start(): Promise<void> {
    const config = await readJsonWithBackup<MidiConfig>(join(this.dataDir, 'midi-map.json'));
    if (config && Array.isArray(config.mappings)) this.config = config;

    let midiModule: unknown;
    try {
      midiModule = await import('@julusian/midi' as string);
    } catch {
      this.log('MIDI: @julusian/midi nicht installiert — Hardware deaktiviert, Mappings editierbar');
      this.emitState();
      return;
    }

    try {
      const { Input } = midiModule as { Input: new () => MidiInputLike };
      const input = new Input();
      const count = input.getPortCount();
      let portIndex = -1;
      for (let i = 0; i < count; i++) {
        const name = input.getPortName(i);
        if (!this.config.input || name.toLowerCase().includes(this.config.input.toLowerCase())) {
          portIndex = i;
          break;
        }
      }
      if (portIndex < 0) {
        this.log(`MIDI: kein passender Input gefunden (${count} Ports)`);
        this.emitState();
        return;
      }
      input.on('message', (_delta, message) => {
        const [status = 0, data1 = 0, data2 = 0] = message;
        this.handleEvent({ status, data1, data2 });
      });
      input.openPort(portIndex);
      this.input = input;
      this.state.available = true;
      this.state.inputName = input.getPortName(portIndex);
      this.log(`MIDI-Input aktiv: ${this.state.inputName}`);
    } catch (error) {
      this.log(`MIDI-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.emitState();
  }

  stop(): void {
    try {
      this.input?.closePort();
    } catch {
      // Shutdown — egal
    }
    this.input = null;
  }

  /** Auch von Tests/Simulationen aufrufbar (ohne Hardware). */
  handleEvent(event: RawMidiEvent): void {
    this.state.lastEvent = event;
    if (this.state.learning) {
      const mapping = mappingFromEvent(event, this.state.learning);
      if (mapping) {
        // Bestehendes Mapping für dieselbe Aktion ersetzen
        this.config.mappings = [
          ...this.config.mappings.filter((candidate) => candidate.action !== mapping.action),
          mapping,
        ];
        delete this.state.learning;
        this.save();
        this.log(`MIDI gelernt: ${mapping.event} ch${mapping.channel} ${mapping.data1} → ${mapping.action}`);
      }
      this.emitState();
      return;
    }
    const action = matchMidiMapping(this.config.mappings, event);
    if (action) this.onAction(action);
  }

  learn(action: RemoteAction): void {
    this.state.learning = action;
    this.emitState();
  }

  cancelLearn(): void {
    delete this.state.learning;
    this.emitState();
  }

  deleteMapping(index: number): void {
    this.config.mappings = this.config.mappings.filter((_, i) => i !== index);
    this.save();
    this.emitState();
  }

  private save(): void {
    void atomicWriteJson(join(this.dataDir, 'midi-map.json'), this.config).catch(
      (error: Error) => this.log(`MIDI-Konfig speichern fehlgeschlagen: ${error.message}`),
    );
  }
}
