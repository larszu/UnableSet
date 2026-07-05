/**
 * WebSocket-Protokoll Host ↔ Clients.
 * Dokumentation: PROTOCOL.md in diesem Package.
 *
 * Grundsatz: Der Host ist die einzige Wahrheitsquelle. Clients senden
 * Kommandos, der Host broadcastet jeden State-Change an alle Clients.
 */

import type {
  BridgeStatus,
  HostState,
  Setlist,
  Song,
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
  /** Prototyp-Sprung direkt auf einen Ableton-Locator (Index in der Cue-Point-Liste). */
  | { action: 'jumpToLocator'; locatorIndex: number };

export type ClientMessage =
  | { type: 'hello'; role?: ViewRole; deviceName?: string }
  | { type: 'ping'; id: number; sentAt: number }
  | { type: 'command'; command: TransportCommand }
  | { type: 'refreshLocators' };

// ---------------------------------------------------------------------------
// Host → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'snapshot'; state: HostState }
  | { type: 'transport'; transport: TransportState }
  | { type: 'songs'; songs: Song[]; setlist: Setlist }
  | { type: 'bridge'; bridge: BridgeStatus }
  | { type: 'pong'; id: number; sentAt: number; serverTime: number };

// ---------------------------------------------------------------------------
// Parsing/Guards — tolerant gegenüber kaputten Frames (Bühne: nie crashen)
// ---------------------------------------------------------------------------

const CLIENT_MESSAGE_TYPES = new Set(['hello', 'ping', 'command', 'refreshLocators']);
const SERVER_MESSAGE_TYPES = new Set(['snapshot', 'transport', 'songs', 'bridge', 'pong']);

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
