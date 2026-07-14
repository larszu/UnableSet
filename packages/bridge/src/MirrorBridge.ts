/**
 * M6-Redundanz: spiegelt alle Transport-/Mixer-Kommandos an zusätzliche
 * AbletonOSC-Rigs (Haupt-/Backup-Rechner). Dekoriert eine primäre Bridge —
 * der Host merkt davon nichts, er spricht weiter das AbletonBridge-Interface.
 *
 * Pro Ziel: eigener Heartbeat (/live/test), Drift-Messung über
 * current_song_time und optionale automatische Drift-Korrektur, die nur
 * eingreift, solange die Abweichung über der Schwelle liegt — sind alle in
 * Sync, passiert nichts (Brief: „schaltet sich automatisch ab").
 */

import { EventEmitter } from 'node:events';
import osc from 'osc';
import type { OscPacket, OscTypedArg, UDPPort } from 'osc';
import {
  OSC_ADDR,
  type BridgeStatus,
  type CuePoint,
  type MirrorTargetStatus,
  type TrackInfo,
} from '@unableset/shared';
import type { AbletonBridge, AbletonBridgeEvents, BridgeTransport } from './AbletonBridge.js';

export interface MirrorTarget {
  address: string;
  port: number;
}

export interface MirrorBridgeOptions {
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  driftCheckMs?: number;
  /** Ab dieser Abweichung (Beats) wird korrigiert. */
  driftThresholdBeats?: number;
  /** Automatische Drift-Korrektur aktiv? */
  correctDrift?: boolean;
  log?: (message: string) => void;
}

interface TargetState {
  target: MirrorTarget;
  port: UDPPort;
  ready: boolean;
  lastHeartbeatAt: number;
  connected: boolean;
  driftBeats: number | undefined;
  corrections: number;
}

export class MirrorBridge extends EventEmitter<AbletonBridgeEvents> implements AbletonBridge {
  private readonly targets: TargetState[] = [];
  private readonly opts: Required<Omit<MirrorBridgeOptions, 'log'>>;
  private readonly log: (message: string) => void;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private driftTimer: NodeJS.Timeout | null = null;
  private started = false;

  constructor(
    private readonly primary: AbletonBridge,
    targets: MirrorTarget[],
    options: MirrorBridgeOptions = {},
  ) {
    super();
    this.opts = {
      heartbeatMs: options.heartbeatMs ?? 2000,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 5000,
      driftCheckMs: options.driftCheckMs ?? 2000,
      driftThresholdBeats: options.driftThresholdBeats ?? 0.25,
      correctDrift: options.correctDrift ?? true,
    };
    this.log = options.log ?? (() => {});

    for (const target of targets) {
      const port = new osc.UDPPort({
        localAddress: '0.0.0.0',
        localPort: 0,
        remoteAddress: target.address,
        remotePort: target.port,
        metadata: true,
      });
      const state: TargetState = {
        target,
        port,
        ready: false,
        lastHeartbeatAt: 0,
        connected: false,
        driftBeats: undefined,
        corrections: 0,
      };
      port.on('message', (packet) => this.onTargetMessage(state, packet));
      port.on('error', () => {
        // UDP-Fehler eines Spiegels sind nie fatal
      });
      this.targets.push(state);
    }

    // Primär-Events unverändert durchreichen
    this.primary.on('status', (status) => this.emit('status', status));
    this.primary.on('transport', (transport) => this.emit('transport', transport));
    this.primary.on('cuePoints', (cuePoints) => this.emit('cuePoints', cuePoints));
    this.primary.on('lyricLines', (lines) => this.emit('lyricLines', lines));
    this.primary.on('songLength', (length) => this.emit('songLength', length));
    this.primary.on('tracks', (tracks) => this.emit('tracks', tracks));
    this.primary.on('bridgeError', (error) => this.emit('bridgeError', error));
  }

  getMirrorStatus(): MirrorTargetStatus[] {
    return this.targets.map((state) => {
      const status: MirrorTargetStatus = {
        address: state.target.address,
        port: state.target.port,
        connected: state.connected,
        corrections: state.corrections,
      };
      if (state.driftBeats !== undefined) status.driftBeats = state.driftBeats;
      return status;
    });
  }

  // --- Lifecycle -------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await Promise.all(
      this.targets.map(
        (state) =>
          new Promise<void>((resolve) => {
            state.port.once('ready', () => {
              state.ready = true;
              resolve();
            });
            state.port.once('error', () => resolve());
            state.port.open();
          }),
      ),
    );

    const beat = () => {
      const now = Date.now();
      for (const state of this.targets) {
        this.sendTo(state, OSC_ADDR.test);
        const connected = now - state.lastHeartbeatAt < this.opts.heartbeatTimeoutMs;
        if (connected !== state.connected) {
          state.connected = connected;
          this.log(
            `Mirror ${state.target.address}:${state.target.port} ${connected ? 'verbunden' : 'getrennt'}`,
          );
          this.emitMirrors();
        }
      }
    };
    this.heartbeatTimer = setInterval(beat, this.opts.heartbeatMs);
    beat();

    this.driftTimer = setInterval(() => {
      for (const state of this.targets) {
        if (state.connected) this.sendTo(state, OSC_ADDR.song.getCurrentSongTime);
      }
    }, this.opts.driftCheckMs);

    await this.primary.connect();
  }

  async disconnect(): Promise<void> {
    this.started = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.heartbeatTimer = null;
    this.driftTimer = null;
    for (const state of this.targets) {
      if (state.ready) state.port.close();
      state.ready = false;
    }
    await this.primary.disconnect();
  }

  // --- Ziel-Kommunikation ------------------------------------------------------

  private sendTo(state: TargetState, address: string, args: OscTypedArg[] = []): void {
    if (!state.ready) return;
    try {
      state.port.send({ address, args });
    } catch {
      // best effort
    }
  }

  private broadcast(address: string, args: OscTypedArg[] = []): void {
    for (const state of this.targets) this.sendTo(state, address, args);
  }

  private onTargetMessage(state: TargetState, packet: OscPacket): void {
    if (packet.address === OSC_ADDR.test) {
      state.lastHeartbeatAt = Date.now();
      return;
    }
    if (packet.address === OSC_ADDR.song.getCurrentSongTime) {
      const value = packet.args[0]?.value;
      if (typeof value !== 'number') return;
      const primaryTransport = this.primary.getTransport();
      const drift = value - primaryTransport.positionBeats;
      state.driftBeats = Math.round(drift * 1000) / 1000;

      if (
        this.opts.correctDrift &&
        primaryTransport.isPlaying &&
        Math.abs(drift) > this.opts.driftThresholdBeats
      ) {
        // Backup auf die Primär-Position ziehen; unter der Schwelle passiert
        // nichts mehr — die Korrektur „schaltet sich ab", sobald in Sync.
        this.sendTo(state, OSC_ADDR.song.setCurrentSongTime, [
          { type: 'f', value: primaryTransport.positionBeats },
        ]);
        state.corrections += 1;
        this.log(
          `Drift-Korrektur ${state.target.address}:${state.target.port}: ${drift.toFixed(3)} Beats`,
        );
      }
      this.emitMirrors();
    }
  }

  private emitMirrors(): void {
    this.emit('mirrors', this.getMirrorStatus());
  }

  // --- Delegation + Fan-out ----------------------------------------------------

  getStatus(): BridgeStatus {
    return this.primary.getStatus();
  }

  getTransport(): BridgeTransport {
    return this.primary.getTransport();
  }

  getCuePoints(): CuePoint[] {
    return this.primary.getCuePoints();
  }

  refreshCuePoints(): Promise<CuePoint[]> {
    return this.primary.refreshCuePoints();
  }

  refreshLyricLines(): Promise<CuePoint[]> {
    return this.primary.refreshLyricLines();
  }

  refreshTracks(): Promise<TrackInfo[]> {
    return this.primary.refreshTracks();
  }

  play(): void {
    this.primary.play();
    // Wie OscAbletonBridge.play(): continue_playing statt start_playing,
    // damit auch die Spiegel-Rigs an der Playhead-Position starten.
    this.broadcast(OSC_ADDR.song.continuePlaying);
  }

  stop(): void {
    this.primary.stop();
    this.broadcast(OSC_ADDR.song.stopPlaying);
  }

  continuePlayback(): void {
    this.primary.continuePlayback();
    this.broadcast(OSC_ADDR.song.continuePlaying);
  }

  jumpToCuePoint(index: number): void {
    this.primary.jumpToCuePoint(index);
    this.broadcast(OSC_ADDR.song.cuePointJump, [{ type: 'i', value: index }]);
  }

  setSongPosition(beats: number): void {
    this.primary.setSongPosition(beats);
    this.broadcast(OSC_ADDR.song.setCurrentSongTime, [{ type: 'f', value: beats }]);
  }

  setLoop(startBeats: number, lengthBeats: number, enabled: boolean): void {
    this.primary.setLoop(startBeats, lengthBeats, enabled);
    this.broadcast(OSC_ADDR.song.setLoopStart, [{ type: 'f', value: startBeats }]);
    this.broadcast(OSC_ADDR.song.setLoopLength, [{ type: 'f', value: lengthBeats }]);
    this.broadcast(OSC_ADDR.song.setLoop, [{ type: 'i', value: enabled ? 1 : 0 }]);
  }

  setLoopEnabled(enabled: boolean): void {
    this.primary.setLoopEnabled(enabled);
    this.broadcast(OSC_ADDR.song.setLoop, [{ type: 'i', value: enabled ? 1 : 0 }]);
  }

  setTrackVolume(trackIndex: number, volume: number): void {
    this.primary.setTrackVolume(trackIndex, volume);
    this.broadcast(OSC_ADDR.track.setVolume, [
      { type: 'i', value: trackIndex },
      { type: 'f', value: volume },
    ]);
  }

  setTrackMute(trackIndex: number, mute: boolean): void {
    this.primary.setTrackMute(trackIndex, mute);
    this.broadcast(OSC_ADDR.track.setMute, [
      { type: 'i', value: trackIndex },
      { type: 'i', value: mute ? 1 : 0 },
    ]);
  }

  setTrackSolo(trackIndex: number, solo: boolean): void {
    this.primary.setTrackSolo(trackIndex, solo);
    this.broadcast(OSC_ADDR.track.setSolo, [
      { type: 'i', value: trackIndex },
      { type: 'i', value: solo ? 1 : 0 },
    ]);
  }
}
