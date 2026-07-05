/**
 * Zentraler State-Store des Hosts — die einzige Wahrheitsquelle.
 * Jede Änderung erzeugt eine ServerMessage, die der WS-Server an alle
 * verbundenen Clients broadcastet.
 */

import { EventEmitter } from 'node:events';
import {
  INITIAL_ENGINE,
  INITIAL_TRANSPORT,
  beatsToBarBeat,
  findSongAtBeat,
  sectionAtBeat,
  type BridgeStatus,
  type ClockRule,
  type EngineState,
  type HostState,
  type MirrorTargetStatus,
  type ServerMessage,
  type Setlist,
  type Song,
  type TrackInfo,
  type TransportState,
} from '@unableset/shared';
import type { BridgeTransport } from '@unableset/bridge';

export interface HostStoreEvents {
  broadcast: [ServerMessage];
}

export class HostStore extends EventEmitter<HostStoreEvents> {
  private readonly serverVersion: string;
  private bridge: BridgeStatus;
  private transport: TransportState = { ...INITIAL_TRANSPORT };
  private songs: Song[] = [];
  private setlists: Setlist[] = [{ id: 'default', name: 'Alle Songs', entries: [] }];
  private activeSetlistId = 'default';
  private engine: EngineState = { ...INITIAL_ENGINE };
  private tracks: TrackInfo[] = [];
  private clockRules: ClockRule[] = [];
  private mirrors: MirrorTargetStatus[] = [];

  constructor(serverVersion: string, initialBridge: BridgeStatus) {
    super();
    this.serverVersion = serverVersion;
    this.bridge = initialBridge;
  }

  getSnapshot(): HostState {
    return {
      serverVersion: this.serverVersion,
      bridge: this.bridge,
      transport: this.transport,
      songs: this.songs,
      setlists: this.setlists,
      activeSetlistId: this.activeSetlistId,
      engine: this.engine,
      tracks: this.tracks,
      clockRules: this.clockRules,
      mirrors: this.mirrors,
    };
  }

  getSongs(): Song[] {
    return this.songs;
  }

  getSetlists(): Setlist[] {
    return this.setlists;
  }

  getActiveSetlistId(): string {
    return this.activeSetlistId;
  }

  getActiveSetlist(): Setlist {
    return (
      this.setlists.find((setlist) => setlist.id === this.activeSetlistId) ?? this.setlists[0]
    );
  }

  getClockRules(): ClockRule[] {
    return this.clockRules;
  }

  setBridgeStatus(bridge: BridgeStatus): void {
    this.bridge = bridge;
    this.emit('broadcast', { type: 'bridge', bridge });
  }

  /** Roh-Transport der Bridge → angereicherter TransportState (Bar/Beat, Song, Section, Queue). */
  applyBridgeTransport(raw: BridgeTransport): void {
    const { bar, beat } = beatsToBarBeat(raw.positionBeats, raw.timeSig);
    const currentSong = findSongAtBeat(this.songs, raw.positionBeats);
    const currentSection = currentSong
      ? sectionAtBeat(currentSong, raw.positionBeats)
      : undefined;

    const transport: TransportState = {
      isPlaying: raw.isPlaying,
      isRecording: this.transport.isRecording,
      positionBeats: raw.positionBeats,
      bar,
      beat,
      bpm: raw.bpm,
      timeSig: raw.timeSig,
    };
    if (currentSong) transport.currentSongId = currentSong.id;
    if (currentSection) transport.currentSectionId = currentSection.id;
    if (this.engine.queued) {
      transport.queuedSongId = this.engine.queued.songId;
      if (this.engine.queued.sectionId) {
        transport.queuedSectionId = this.engine.queued.sectionId;
      }
    }

    this.transport = transport;
    this.emit('broadcast', { type: 'transport', transport });
  }

  getTransport(): TransportState {
    return this.transport;
  }

  setSongs(songs: Song[]): void {
    this.songs = songs;
    // Default-Setlist spiegelt immer die Arrangement-Reihenfolge
    const defaultSetlist = this.setlists.find((setlist) => setlist.id === 'default');
    if (defaultSetlist) {
      defaultSetlist.entries = songs.map((song, index) => ({
        entryId: `default-${index}-${song.id}`,
        songId: song.id,
      }));
    }
    this.emit('broadcast', { type: 'songs', songs });
    this.emitSetlists();
    this.refreshTransportDecorations();
  }

  setSetlists(setlists: Setlist[], activeSetlistId: string): void {
    this.setlists = setlists;
    this.activeSetlistId = setlists.some((setlist) => setlist.id === activeSetlistId)
      ? activeSetlistId
      : (setlists[0]?.id ?? 'default');
    this.emitSetlists();
  }

  private emitSetlists(): void {
    this.emit('broadcast', {
      type: 'setlists',
      setlists: this.setlists,
      activeSetlistId: this.activeSetlistId,
    });
  }

  setEngineState(engine: EngineState): void {
    this.engine = engine;
    this.emit('broadcast', { type: 'engine', engine });
    this.refreshTransportDecorations();
  }

  setTracks(tracks: TrackInfo[]): void {
    this.tracks = tracks;
    this.emit('broadcast', { type: 'tracks', tracks });
  }

  setClockRules(rules: ClockRule[]): void {
    this.clockRules = rules;
    this.emit('broadcast', { type: 'clockRules', rules });
  }

  setMirrors(mirrors: MirrorTargetStatus[]): void {
    this.mirrors = mirrors;
    this.emit('broadcast', { type: 'mirrors', mirrors });
  }

  /** Aktualisiert Song-/Section-/Queue-Felder im Transport nach State-Änderungen. */
  private refreshTransportDecorations(): void {
    const currentSong = findSongAtBeat(this.songs, this.transport.positionBeats);
    const currentSection = currentSong
      ? sectionAtBeat(currentSong, this.transport.positionBeats)
      : undefined;
    const transport: TransportState = { ...this.transport };
    delete transport.currentSongId;
    delete transport.currentSectionId;
    delete transport.queuedSongId;
    delete transport.queuedSectionId;
    if (currentSong) transport.currentSongId = currentSong.id;
    if (currentSection) transport.currentSectionId = currentSection.id;
    if (this.engine.queued) {
      transport.queuedSongId = this.engine.queued.songId;
      if (this.engine.queued.sectionId) {
        transport.queuedSectionId = this.engine.queued.sectionId;
      }
    }
    const changed = JSON.stringify(transport) !== JSON.stringify(this.transport);
    if (changed) {
      this.transport = transport;
      this.emit('broadcast', { type: 'transport', transport });
    }
  }
}
