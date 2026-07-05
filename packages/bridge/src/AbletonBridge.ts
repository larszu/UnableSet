/**
 * Abstraktion der Ableton-Anbindung. Weg A (OSC-Remote-Script, AbletonOSC-
 * Stil) und Weg B (Max for Live, beat-genau) implementieren dieses Interface,
 * damit der Host sie austauschen kann, ohne dass sich sonst etwas ändert.
 */

import type { EventEmitter } from 'node:events';
import type { BridgeStatus, CuePoint, TrackInfo } from '@unableset/shared';

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
  /** Track-Liste (Mixer) wurde (neu) gelesen. */
  tracks: [TrackInfo[]];
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
  /** Zuletzt gelesene Cue-Point-Liste (Index-Basis für jumpToCuePoint). */
  getCuePoints(): CuePoint[];
  /** Cue Points neu aus Live lesen; emittiert zusätzlich `cuePoints`. */
  refreshCuePoints(): Promise<CuePoint[]>;

  play(): void;
  stop(): void;
  continuePlayback(): void;
  /** Springt auf einen Cue Point (Index in der zuletzt gelesenen Liste). */
  jumpToCuePoint(index: number): void;
  /** Setzt die Song-Position (Beats) — Basis aller Setlist-Jumps. */
  setSongPosition(beats: number): void;

  /** Ableton-Loop-Bracket setzen/aktivieren (für Section-Loops). */
  setLoop(startBeats: number, lengthBeats: number, enabled: boolean): void;
  setLoopEnabled(enabled: boolean): void;

  /** Mixer: Tracks neu aus Live lesen; emittiert zusätzlich `tracks`. */
  refreshTracks(): Promise<TrackInfo[]>;
  setTrackVolume(trackIndex: number, volume: number): void;
  setTrackMute(trackIndex: number, mute: boolean): void;
  setTrackSolo(trackIndex: number, solo: boolean): void;
}
