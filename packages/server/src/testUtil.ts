/**
 * Gemeinsame Test-Fakes für Server-Tests. Nur in Tests verwendet —
 * die produktiven Pfade laufen gegen die echte OSC-Bridge.
 */

import { EventEmitter } from 'node:events';
import type { BridgeStatus, CuePoint, TrackInfo } from '@unableset/shared';
import type { AbletonBridge, AbletonBridgeEvents, BridgeTransport } from '@unableset/bridge';

export class FakeBridge extends EventEmitter<AbletonBridgeEvents> implements AbletonBridge {
  actions: string[] = [];
  cuePoints: CuePoint[] = [];
  tracks: TrackInfo[] = [];
  transport: BridgeTransport = {
    isPlaying: false,
    positionBeats: 0,
    bpm: 120,
    timeSig: [4, 4],
  };
  loop = { start: 0, length: 4, enabled: false };

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  getStatus(): BridgeStatus {
    return { kind: 'osc', connected: true, remoteAddress: '127.0.0.1', remotePort: 11000 };
  }

  getTransport(): BridgeTransport {
    return { ...this.transport, timeSig: [...this.transport.timeSig] };
  }

  getCuePoints(): CuePoint[] {
    return this.cuePoints;
  }

  async refreshCuePoints(): Promise<CuePoint[]> {
    this.actions.push('refreshCuePoints');
    this.emit('cuePoints', this.cuePoints);
    return this.cuePoints;
  }

  lyricLines: CuePoint[] = [];

  async refreshLyricLines(): Promise<CuePoint[]> {
    this.actions.push('refreshLyricLines');
    this.emit('lyricLines', this.lyricLines);
    return this.lyricLines;
  }

  play(): void {
    this.actions.push('play');
    this.transport.isPlaying = true;
  }

  stop(): void {
    this.actions.push('stop');
    this.transport.isPlaying = false;
  }

  continuePlayback(): void {
    this.actions.push('continue');
    this.transport.isPlaying = true;
  }

  jumpToCuePoint(index: number): void {
    this.actions.push(`jump:${index}`);
  }

  setSongPosition(beats: number): void {
    this.actions.push(`pos:${beats}`);
    this.transport.positionBeats = beats;
  }

  setLoop(startBeats: number, lengthBeats: number, enabled: boolean): void {
    this.actions.push(`loop:${startBeats}:${lengthBeats}:${enabled}`);
    this.loop = { start: startBeats, length: lengthBeats, enabled };
  }

  setLoopEnabled(enabled: boolean): void {
    this.actions.push(`loopEnabled:${enabled}`);
    this.loop.enabled = enabled;
  }

  async refreshTracks(): Promise<TrackInfo[]> {
    this.actions.push('refreshTracks');
    this.emit('tracks', this.tracks);
    return this.tracks;
  }

  setTrackVolume(trackIndex: number, volume: number): void {
    this.actions.push(`vol:${trackIndex}:${volume}`);
  }

  setTrackMute(trackIndex: number, mute: boolean): void {
    this.actions.push(`mute:${trackIndex}:${mute}`);
  }

  setTrackSolo(trackIndex: number, solo: boolean): void {
    this.actions.push(`solo:${trackIndex}:${solo}`);
  }
}
