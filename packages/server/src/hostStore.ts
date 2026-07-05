/**
 * Zentraler State-Store des Hosts — die einzige Wahrheitsquelle.
 * Jede Änderung erzeugt eine ServerMessage, die der WS-Server an alle
 * verbundenen Clients broadcastet.
 */

import { EventEmitter } from 'node:events';
import {
  INITIAL_TRANSPORT,
  beatsToBarBeat,
  findSongAtBeat,
  type BridgeStatus,
  type HostState,
  type ServerMessage,
  type Setlist,
  type Song,
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
  private setlist: Setlist = { id: 'default', name: 'Setlist', entries: [] };

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
      setlist: this.setlist,
    };
  }

  setBridgeStatus(bridge: BridgeStatus): void {
    this.bridge = bridge;
    this.emit('broadcast', { type: 'bridge', bridge });
  }

  /** Roh-Transport der Bridge → angereicherter TransportState (Bar/Beat, Song). */
  applyBridgeTransport(raw: BridgeTransport): void {
    const { bar, beat } = beatsToBarBeat(raw.positionBeats, raw.timeSig);
    const currentSong = findSongAtBeat(this.songs, raw.positionBeats);

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
    if (this.transport.queuedSongId !== undefined) {
      transport.queuedSongId = this.transport.queuedSongId;
    }

    this.transport = transport;
    this.emit('broadcast', { type: 'transport', transport });
  }

  /** Neue Songliste aus den Locators; Setlist folgt in M0 der Song-Reihenfolge. */
  setSongs(songs: Song[]): void {
    this.songs = songs;
    this.setlist = {
      ...this.setlist,
      entries: songs.map((song, index) => ({
        entryId: `entry-${index}-${song.id}`,
        songId: song.id,
      })),
    };
    this.emit('broadcast', { type: 'songs', songs, setlist: this.setlist });
    // currentSongId kann sich durch neue Song-Grenzen ändern
    this.refreshCurrentSong();
  }

  private refreshCurrentSong(): void {
    const currentSong = findSongAtBeat(this.songs, this.transport.positionBeats);
    const currentSongId = currentSong?.id;
    if (currentSongId !== this.transport.currentSongId) {
      const transport: TransportState = { ...this.transport };
      if (currentSongId === undefined) delete transport.currentSongId;
      else transport.currentSongId = currentSongId;
      this.transport = transport;
      this.emit('broadcast', { type: 'transport', transport });
    }
  }
}
