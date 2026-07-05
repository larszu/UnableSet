/**
 * Abstraktion der Ableton-Anbindung. Weg A (OSC-Remote-Script, AbletonOSC-
 * Stil) und Weg B (Max for Live, beat-genau) implementieren dieses Interface,
 * damit der Host sie austauschen kann, ohne dass sich sonst etwas ändert.
 */

import type { EventEmitter } from 'node:events';
import type { BridgeStatus, CuePoint } from '@unableset/shared';

/** Roh-Transportdaten, wie die Bridge sie aus Live liest. */
export interface BridgeTransport {
  isPlaying: boolean;
  /** Position in Beats (Viertelnoten, `current_song_time`). */
  positionBeats: number;
  bpm: number;
  timeSig: [number, number];
}

export interface AbletonBridgeEvents {
  /** Verbindungsstatus zu Live hat sich geändert. */
  status: [BridgeStatus];
  /** Transport-Snapshot (Position/Tempo/Playing/Taktart) hat sich geändert. */
  transport: [BridgeTransport];
  /** Cue-Point-Liste wurde (neu) gelesen. */
  cuePoints: [CuePoint[]];
  /** Arrangement-Länge in Beats wurde gelesen. */
  songLength: [number];
  /** Nicht-fataler Fehler (nur Logging — die Show läuft weiter). */
  bridgeError: [Error];
}

export interface AbletonBridge extends EventEmitter<AbletonBridgeEvents> {
  /** Baut die Verbindung auf und hält sie (Reconnect inklusive). Idempotent. */
  connect(): Promise<void>;
  /** Trennt sauber (Listener in Live abmelden, Sockets schließen). */
  disconnect(): Promise<void>;
  getStatus(): BridgeStatus;
  getTransport(): BridgeTransport;
  /** Cue Points neu aus Live lesen; emittiert zusätzlich `cuePoints`. */
  refreshCuePoints(): Promise<CuePoint[]>;
  play(): void;
  stop(): void;
  continuePlayback(): void;
  /** Springt auf einen Cue Point (Index in der zuletzt gelesenen Liste). */
  jumpToCuePoint(index: number): void;
}
