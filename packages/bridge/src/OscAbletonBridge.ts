/**
 * Ableton-Bridge Weg A: spricht per OSC/UDP mit dem AbletonOSC-Remote-Script
 * in Live (Standard: senden an 11000, empfangen auf 11001).
 *
 * Robustheits-Grundsätze:
 * - Verbindungsaufbau/-verlust wird über einen /live/test-Heartbeat erkannt;
 *   die Bridge versucht endlos weiter (Reconnect ist ihr Normalzustand).
 * - Kein Fehler der Bridge darf das laufende Ableton-Playback beeinflussen —
 *   sie sendet nur auf explizite Kommandos Transport-Befehle.
 */

import { EventEmitter } from 'node:events';
import osc from 'osc';
import type { OscPacket, UDPPort } from 'osc';
import {
  ABLETON_OSC_DEFAULT_RECEIVE_PORT,
  ABLETON_OSC_DEFAULT_SEND_PORT,
  OSC_ADDR,
  OSC_LISTEN_PROPS,
  oscStartListen,
  oscStopListen,
  type BridgeStatus,
  type CuePoint,
  type TrackInfo,
} from '@unableset/shared';
import type { AbletonBridge, AbletonBridgeEvents, BridgeTransport } from './AbletonBridge.js';
import { toTypedOscArgs } from './oscArgs.js';

export interface OscAbletonBridgeOptions {
  /** Adresse des Rechners, auf dem Live läuft. */
  remoteAddress?: string;
  /** Port, auf dem AbletonOSC lauscht. */
  remotePort?: number;
  /** Lokaler Empfangsport für Antworten. */
  localPort?: number;
  /** Polling-Intervall für die Song-Position bei laufendem Playback (ms). */
  positionPollMs?: number;
  /** Heartbeat-Intervall (ms). */
  heartbeatMs?: number;
  /** Ohne Heartbeat-Antwort nach dieser Zeit gilt Live als getrennt (ms). */
  heartbeatTimeoutMs?: number;
  /** Antwort-Timeout für einzelne Requests (ms). */
  requestTimeoutMs?: number;
  log?: (message: string) => void;
}

interface PendingRequest {
  resolve: (args: unknown[]) => void;
  timer: NodeJS.Timeout;
}

function argValues(packet: OscPacket): unknown[] {
  return packet.args.map((arg) => arg.value);
}

export class OscAbletonBridge extends EventEmitter<AbletonBridgeEvents> implements AbletonBridge {
  private readonly opts: Required<Omit<OscAbletonBridgeOptions, 'log'>>;
  private readonly log: (message: string) => void;

  private port: UDPPort | null = null;
  private portReady = false;
  private started = false;

  private connected = false;
  private liveVersion: string | undefined;
  private lastHeartbeatAt: number | undefined;

  private transport: BridgeTransport = {
    isPlaying: false,
    positionBeats: 0,
    bpm: 120,
    timeSig: [4, 4],
  };
  private cuePoints: CuePoint[] = [];

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private positionTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string, PendingRequest[]>();

  constructor(options: OscAbletonBridgeOptions = {}) {
    super();
    this.opts = {
      remoteAddress: options.remoteAddress ?? '127.0.0.1',
      remotePort: options.remotePort ?? ABLETON_OSC_DEFAULT_SEND_PORT,
      localPort: options.localPort ?? ABLETON_OSC_DEFAULT_RECEIVE_PORT,
      positionPollMs: options.positionPollMs ?? 100,
      heartbeatMs: options.heartbeatMs ?? 2000,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 5000,
      requestTimeoutMs: options.requestTimeoutMs ?? 1500,
    };
    this.log = options.log ?? (() => {});
  }

  getStatus(): BridgeStatus {
    const status: BridgeStatus = {
      kind: 'osc',
      connected: this.connected,
      remoteAddress: this.opts.remoteAddress,
      remotePort: this.opts.remotePort,
    };
    if (this.liveVersion !== undefined) status.liveVersion = this.liveVersion;
    if (this.lastHeartbeatAt !== undefined) status.lastHeartbeatAt = this.lastHeartbeatAt;
    return status;
  }

  getTransport(): BridgeTransport {
    return { ...this.transport, timeSig: [...this.transport.timeSig] };
  }

  /** Zuletzt gelesene Cue-Point-Liste (Index-Basis für jumpToCuePoint). */
  getCuePoints(): CuePoint[] {
    return [...this.cuePoints];
  }

  async connect(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const port = new osc.UDPPort({
      localAddress: '0.0.0.0',
      localPort: this.opts.localPort,
      remoteAddress: this.opts.remoteAddress,
      remotePort: this.opts.remotePort,
      metadata: true,
    });
    this.port = port;

    port.on('message', (packet) => this.onMessage(packet));
    port.on('error', (error) => {
      // UDP-Fehler sind nie fatal — loggen und weiterlaufen
      this.log(`OSC-Fehler: ${error.message}`);
      this.emit('bridgeError', error);
    });

    await new Promise<void>((resolve, reject) => {
      port.once('ready', () => {
        this.portReady = true;
        resolve();
      });
      port.once('error', (error) => {
        if (!this.portReady) reject(error);
      });
      port.open();
    });

    this.log(
      `OSC-Bridge lauscht auf :${this.opts.localPort}, sendet an ${this.opts.remoteAddress}:${this.opts.remotePort}`,
    );
    this.startHeartbeat();
  }

  async disconnect(): Promise<void> {
    this.started = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.stopPositionPolling();

    if (this.port && this.portReady && this.connected) {
      for (const prop of OSC_LISTEN_PROPS) {
        this.send(oscStopListen(prop));
      }
    }
    for (const queue of this.pending.values()) {
      for (const request of queue) clearTimeout(request.timer);
    }
    this.pending.clear();

    if (this.port) {
      this.port.close();
      this.port = null;
      this.portReady = false;
    }
    this.setConnected(false);
  }

  // -------------------------------------------------------------------------
  // Kommandos (nur auf expliziten Aufruf — nie automatisch)
  // -------------------------------------------------------------------------

  play(): void {
    this.send(OSC_ADDR.song.startPlaying);
  }

  stop(): void {
    this.send(OSC_ADDR.song.stopPlaying);
  }

  continuePlayback(): void {
    this.send(OSC_ADDR.song.continuePlaying);
  }

  jumpToCuePoint(index: number): void {
    this.send(OSC_ADDR.song.cuePointJump, [index]);
  }

  setSongPosition(beats: number): void {
    // Explizit als Float senden (Ganzzahlen würden sonst als 'i' kodiert)
    this.sendFloat(OSC_ADDR.song.setCurrentSongTime, beats);
    // Lokalen Zustand sofort nachziehen, damit Grenz-Checks nicht doppelt feuern
    this.transport.positionBeats = beats;
    this.emitTransport();
    this.send(OSC_ADDR.song.getCurrentSongTime);
  }

  setLoop(startBeats: number, lengthBeats: number, enabled: boolean): void {
    this.sendFloat(OSC_ADDR.song.setLoopStart, startBeats);
    this.sendFloat(OSC_ADDR.song.setLoopLength, lengthBeats);
    this.send(OSC_ADDR.song.setLoop, [enabled ? 1 : 0]);
  }

  setLoopEnabled(enabled: boolean): void {
    this.send(OSC_ADDR.song.setLoop, [enabled ? 1 : 0]);
  }

  async refreshTracks(): Promise<TrackInfo[]> {
    const numArgs = await this.request(OSC_ADDR.song.getNumTracks);
    const numTracks = typeof numArgs[0] === 'number' ? numArgs[0] : 0;
    const tracks: TrackInfo[] = [];
    for (let i = 0; i < numTracks; i++) {
      // Antworten tragen [trackIndex, wert] — sequenziell abfragen, defensiv parsen
      const [nameArgs, volumeArgs, muteArgs, soloArgs] = [
        await this.request(OSC_ADDR.track.getName, [i]).catch(() => []),
        await this.request(OSC_ADDR.track.getVolume, [i]).catch(() => []),
        await this.request(OSC_ADDR.track.getMute, [i]).catch(() => []),
        await this.request(OSC_ADDR.track.getSolo, [i]).catch(() => []),
      ];
      tracks.push({
        index: i,
        name: typeof nameArgs[1] === 'string' ? nameArgs[1] : `Track ${i + 1}`,
        volume: typeof volumeArgs[1] === 'number' ? volumeArgs[1] : 0.85,
        mute: muteArgs[1] === 1 || muteArgs[1] === true,
        solo: soloArgs[1] === 1 || soloArgs[1] === true,
      });
    }
    this.emit('tracks', tracks);
    return tracks;
  }

  setTrackVolume(trackIndex: number, volume: number): void {
    if (!this.port || !this.portReady) return;
    try {
      this.port.send({
        address: OSC_ADDR.track.setVolume,
        args: [
          { type: 'i', value: trackIndex },
          { type: 'f', value: Math.min(1, Math.max(0, volume)) },
        ],
      });
    } catch (error) {
      this.emit('bridgeError', error instanceof Error ? error : new Error(String(error)));
    }
  }

  setTrackMute(trackIndex: number, mute: boolean): void {
    this.send(OSC_ADDR.track.setMute, [trackIndex, mute ? 1 : 0]);
  }

  setTrackSolo(trackIndex: number, solo: boolean): void {
    this.send(OSC_ADDR.track.setSolo, [trackIndex, solo ? 1 : 0]);
  }

  async refreshCuePoints(): Promise<CuePoint[]> {
    const args = await this.request(OSC_ADDR.song.getCuePoints);
    const cuePoints: CuePoint[] = [];
    // Antwortformat: abwechselnd Name (string) und Zeit in Beats (number)
    for (let i = 0; i + 1 < args.length; i += 2) {
      const name = args[i];
      const time = args[i + 1];
      if (typeof name === 'string' && typeof time === 'number') {
        cuePoints.push({ name, timeBeats: time });
      }
    }
    cuePoints.sort((a, b) => a.timeBeats - b.timeBeats);
    this.cuePoints = cuePoints;
    this.emit('cuePoints', cuePoints);
    return cuePoints;
  }

  // -------------------------------------------------------------------------
  // Verbindung & Sync
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    const beat = async () => {
      if (!this.started) return;
      try {
        await this.request(OSC_ADDR.test, [], this.opts.heartbeatTimeoutMs);
        this.lastHeartbeatAt = Date.now();
        if (!this.connected) await this.onLiveAppeared();
      } catch {
        if (this.connected) {
          this.log('Heartbeat-Timeout — Verbindung zu Live verloren, versuche weiter …');
          this.setConnected(false);
          this.stopPositionPolling();
        }
      }
    };
    void beat();
    this.heartbeatTimer = setInterval(() => void beat(), this.opts.heartbeatMs);
  }

  /** Erstkontakt bzw. Wiederverbindung: Grundzustand einlesen + Listener setzen. */
  private async onLiveAppeared(): Promise<void> {
    this.setConnected(true);
    this.log('Verbindung zu Ableton Live hergestellt');

    try {
      const version = await this.request(OSC_ADDR.application.getVersion);
      if (version.length > 0) {
        this.liveVersion = version.map(String).join('.');
        this.emit('status', this.getStatus());
      }
    } catch {
      // Version ist rein informativ
    }

    for (const prop of OSC_LISTEN_PROPS) {
      this.send(oscStartListen(prop));
    }

    await Promise.allSettled([
      this.queryNumber(OSC_ADDR.song.getTempo),
      this.queryNumber(OSC_ADDR.song.getIsPlaying),
      this.queryNumber(OSC_ADDR.song.getSignatureNumerator),
      this.queryNumber(OSC_ADDR.song.getSignatureDenominator),
      this.queryNumber(OSC_ADDR.song.getCurrentSongTime),
      this.queryNumber(OSC_ADDR.song.getSongLength),
      this.refreshCuePoints().catch(() => undefined),
    ]);
  }

  /** Fragt eine numerische Property ab; die Antwort läuft über onMessage. */
  private async queryNumber(address: string): Promise<void> {
    await this.request(address).catch(() => undefined);
  }

  private startPositionPolling(): void {
    if (this.positionTimer) return;
    this.positionTimer = setInterval(() => {
      this.send(OSC_ADDR.song.getCurrentSongTime);
    }, this.opts.positionPollMs);
  }

  private stopPositionPolling(): void {
    if (this.positionTimer) clearInterval(this.positionTimer);
    this.positionTimer = null;
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.emit('status', this.getStatus());
  }

  // -------------------------------------------------------------------------
  // OSC-Nachrichten
  // -------------------------------------------------------------------------

  private send(address: string, args: (number | string)[] = []): void {
    if (!this.port || !this.portReady) return;
    try {
      this.port.send({ address, args: toTypedOscArgs(args) });
    } catch (error) {
      this.emit('bridgeError', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Sendet einen einzelnen Wert erzwungen als OSC-Float. */
  private sendFloat(address: string, value: number): void {
    if (!this.port || !this.portReady) return;
    try {
      this.port.send({ address, args: [{ type: 'f', value }] });
    } catch (error) {
      this.emit('bridgeError', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Sendet eine Anfrage und wartet auf die Antwort mit derselben Adresse. */
  private request(
    address: string,
    args: (number | string)[] = [],
    timeoutMs = this.opts.requestTimeoutMs,
  ): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
      const queue = this.pending.get(address) ?? [];
      const entry: PendingRequest = {
        resolve,
        timer: setTimeout(() => {
          const current = this.pending.get(address) ?? [];
          const index = current.indexOf(entry);
          if (index >= 0) current.splice(index, 1);
          reject(new Error(`Timeout für ${address}`));
        }, timeoutMs),
      };
      queue.push(entry);
      this.pending.set(address, queue);
      this.send(address, args);
    });
  }

  private onMessage(packet: OscPacket): void {
    const values = argValues(packet);

    // Ausstehende Anfrage mit derselben Adresse auflösen (FIFO) …
    const queue = this.pending.get(packet.address);
    if (queue && queue.length > 0) {
      const entry = queue.shift() as PendingRequest;
      clearTimeout(entry.timer);
      entry.resolve(values);
    }

    // … und zusätzlich immer als State-Update verarbeiten (Listener-Pushes
    // von AbletonOSC kommen unaufgefordert mit denselben Adressen).
    this.applyStateUpdate(packet.address, values);
  }

  private applyStateUpdate(address: string, values: unknown[]): void {
    const first = values[0];
    switch (address) {
      case OSC_ADDR.song.getTempo:
        if (typeof first === 'number' && first > 0 && first !== this.transport.bpm) {
          this.transport.bpm = first;
          this.emitTransport();
        }
        break;
      case OSC_ADDR.song.getIsPlaying: {
        const isPlaying = first === true || first === 1;
        if (isPlaying !== this.transport.isPlaying) {
          this.transport.isPlaying = isPlaying;
          if (isPlaying) this.startPositionPolling();
          else this.stopPositionPolling();
          // Position einmalig nachziehen (z. B. Sprung an Songanfang bei Stop)
          this.send(OSC_ADDR.song.getCurrentSongTime);
          this.emitTransport();
        }
        break;
      }
      case OSC_ADDR.song.getCurrentSongTime:
        if (typeof first === 'number' && first !== this.transport.positionBeats) {
          this.transport.positionBeats = first;
          this.emitTransport();
        }
        break;
      case OSC_ADDR.song.getSignatureNumerator:
        if (typeof first === 'number' && first > 0 && first !== this.transport.timeSig[0]) {
          this.transport.timeSig = [first, this.transport.timeSig[1]];
          this.emitTransport();
        }
        break;
      case OSC_ADDR.song.getSignatureDenominator:
        if (typeof first === 'number' && first > 0 && first !== this.transport.timeSig[1]) {
          this.transport.timeSig = [this.transport.timeSig[0], first];
          this.emitTransport();
        }
        break;
      case OSC_ADDR.song.getSongLength:
        if (typeof first === 'number' && first > 0) {
          this.emit('songLength', first);
        }
        break;
      default:
        break;
    }
  }

  private emitTransport(): void {
    this.emit('transport', this.getTransport());
  }
}
