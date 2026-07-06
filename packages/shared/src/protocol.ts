/**
 * WebSocket-Protokoll Host ↔ Clients.
 * Dokumentation: PROTOCOL.md in diesem Package.
 *
 * Grundsatz: Der Host ist die einzige Wahrheitsquelle. Clients senden
 * Kommandos, der Host broadcastet jeden State-Change an alle Clients.
 */

import type {
  BridgeStatus,
  ClockRule,
  EngineState,
  HostState,
  JumpMode,
  MidiState,
  MirrorTargetStatus,
  OscMessage,
  ProjectFileInfo,
  RemoteActionName,
  Setlist,
  Song,
  SongId,
  TrackInfo,
  TransportState,
  ViewRole,
} from './types.js';

// ---------------------------------------------------------------------------
// Client → Host
// ---------------------------------------------------------------------------

export type TransportCommand =
  | { action: 'play' }
  | { action: 'stop' }
  | { action: 'continue' }
  | { action: 'jumpToLocator'; locatorIndex: number };

export type ClientMessage =
  | { type: 'hello'; role?: ViewRole; deviceName?: string }
  | { type: 'ping'; id: number; sentAt: number }
  | { type: 'command'; command: TransportCommand }
  | { type: 'refreshLocators' }
  // --- Queue & Jumps (M2) ---
  | { type: 'queue'; songId: SongId; entryId?: string; sectionId?: string }
  | { type: 'clearQueue' }
  /** Gequeueten Sprung sofort ausführen (ohne auf die Quantisierung zu warten). */
  | { type: 'jumpNow' }
  | { type: 'nextSong' }
  | { type: 'prevSong' }
  | { type: 'setJumpMode'; mode: JumpMode }
  | { type: 'setSafeMode'; enabled: boolean }
  | { type: 'setPreRoll'; bars: number }
  | { type: 'setHidePlayed'; enabled: boolean }
  | { type: 'markPlayed'; entryId: string; played: boolean }
  | { type: 'loopSection'; songId: SongId; sectionId: string; enabled: boolean }
  // --- Setlist-Editor (M3) ---
  | { type: 'setlistUpdate'; setlist: Setlist }
  | { type: 'setlistCreate'; name: string; copyFromId?: string }
  | { type: 'setlistDelete'; setlistId: string }
  | { type: 'setlistActivate'; setlistId: string }
  | { type: 'setlistImportText'; name: string; text: string }
  // --- Mixer (M5) ---
  | { type: 'mixerRefresh' }
  | { type: 'mixerSet'; trackIndex: number; field: 'volume' | 'mute' | 'solo'; value: number | boolean }
  // --- Clock-Aktionen (M8) ---
  | { type: 'clockRulesUpdate'; rules: ClockRule[] }
  // --- MIDI-Learn (M5) ---
  | { type: 'midiLearnStart'; action: RemoteActionName }
  | { type: 'midiLearnCancel' }
  | { type: 'midiMappingDelete'; index: number }
  // --- Lyrics aus MIDI-Clips (M4) ---
  | { type: 'refreshLyrics' }
  // --- BandHelper-/CSV-Import (M8) ---
  | { type: 'setlistImportCsv'; name: string; csv: string }
  // --- Multi-File-Projekte (M8) ---
  | { type: 'projectOpen'; path: string }
  // --- Canvas & Scripting (M7) ---
  | { type: 'sendOsc'; message: OscMessage }
  | { type: 'sharedSet'; key: string; value: string | number | boolean };

// ---------------------------------------------------------------------------
// Host → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'snapshot'; state: HostState }
  | { type: 'transport'; transport: TransportState }
  | { type: 'songs'; songs: Song[] }
  | { type: 'setlists'; setlists: Setlist[]; activeSetlistId: string }
  | { type: 'engine'; engine: EngineState }
  | { type: 'tracks'; tracks: TrackInfo[] }
  | { type: 'clockRules'; rules: ClockRule[] }
  | { type: 'bridge'; bridge: BridgeStatus }
  | { type: 'mirrors'; mirrors: MirrorTargetStatus[] }
  | { type: 'midi'; midi: MidiState }
  | { type: 'projects'; projects: ProjectFileInfo[] }
  | { type: 'shared'; values: Record<string, string | number | boolean> }
  | { type: 'pong'; id: number; sentAt: number; serverTime: number };

// ---------------------------------------------------------------------------
// Parsing/Guards — tolerant gegenüber kaputten Frames (Bühne: nie crashen)
// ---------------------------------------------------------------------------

const CLIENT_MESSAGE_TYPES = new Set([
  'hello',
  'ping',
  'command',
  'refreshLocators',
  'queue',
  'clearQueue',
  'jumpNow',
  'nextSong',
  'prevSong',
  'setJumpMode',
  'setSafeMode',
  'setPreRoll',
  'setHidePlayed',
  'markPlayed',
  'loopSection',
  'setlistUpdate',
  'setlistCreate',
  'setlistDelete',
  'setlistActivate',
  'setlistImportText',
  'mixerRefresh',
  'mixerSet',
  'clockRulesUpdate',
  'midiLearnStart',
  'midiLearnCancel',
  'midiMappingDelete',
  'refreshLyrics',
  'setlistImportCsv',
  'projectOpen',
  'sendOsc',
  'sharedSet',
]);

const SERVER_MESSAGE_TYPES = new Set([
  'snapshot',
  'transport',
  'songs',
  'setlists',
  'engine',
  'tracks',
  'clockRules',
  'bridge',
  'mirrors',
  'midi',
  'projects',
  'shared',
  'pong',
]);

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' && !(raw instanceof Uint8Array)) return null;
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parst einen eingehenden Client-Frame; `null` bei ungültigen Daten. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  const value = parseJson(raw);
  if (!value || typeof value.type !== 'string' || !CLIENT_MESSAGE_TYPES.has(value.type)) {
    return null;
  }
  return value as unknown as ClientMessage;
}

/** Parst einen eingehenden Server-Frame; `null` bei ungültigen Daten. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  const value = parseJson(raw);
  if (!value || typeof value.type !== 'string' || !SERVER_MESSAGE_TYPES.has(value.type)) {
    return null;
  }
  return value as unknown as ServerMessage;
}

export function serializeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/** Pfad, unter dem der Host den WebSocket-Server anbietet. */
export const WS_PATH = '/ws';
