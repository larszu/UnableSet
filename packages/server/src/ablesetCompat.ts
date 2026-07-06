/**
 * AbleSet-Companion-Kompatibilität (Clean-Room-Interoperabilität).
 *
 * Implementiert den OSC-Adressraum, den das quelloffene Bitfocus-Companion-
 * Modul `companion-module-leolabs-ableset` (MIT) mit AbleSet spricht — so
 * steuert das *vorhandene* AbleSet-Modul UnableSet, ohne dass hier AbleSet-
 * oder Modul-Code übernommen wird. Grundlage ist ausschließlich der öffentlich
 * dokumentierte Adressraum (beta.ableset.com/docs/osc) und die öffentliche
 * Modul-Quelle.
 *
 * Ablauf (wie im Modul):
 *   Companion → /subscribe ['auto', <clientPort>, 'Companion', <fineUpdates>]
 *   Companion → /getValues
 *   UnableSet → sendet alle Werte an <senderIP>:<clientPort>
 *   … laufend Werte-Updates; Companion erkennt Verbindungsverlust nach 3 s
 *      ohne Nachricht → wir senden mind. 1×/s einen Keepalive.
 *   Companion → /unsubscribe
 *
 * Ports: AbleSet lauscht auf UDP 39051; Antworten gehen an den vom Client im
 * /subscribe genannten Port.
 */

import osc from 'osc';
import type { OscPacket, OscTypedArg, RemoteInfo, UDPPort } from 'osc';
import {
  beatsToBarBeat,
  beatsToSeconds,
  findSongAtBeat,
  quarterBeatsPerBar,
  sectionAtBeat,
  type HostState,
  type JumpMode,
  type Section,
} from '@unableset/shared';
import type { HostStore } from './hostStore.js';
import type { SetlistEngine } from './setlistEngine.js';
import type { AbletonBridge } from '@unableset/bridge';

export const ABLESET_DEFAULT_PORT = 39051;

/**
 * Kalibrier-Konstanten (der einzige Punkt, der gegen echtes AbleSet zu
 * bestätigen ist): AbleSet nummeriert Song-/Section-Positionen für
 * `jumpToSong`/`jumpToSection` 1-basiert ("Position"), sendet die aktiven
 * Indizes aber 0-basiert. Beides hier explizit, leicht umstellbar.
 */
const JUMP_POSITION_BASE = 1;
const ACTIVE_INDEX_BASE = 0;

/** UnableSet-JumpMode ↔ AbleSet-jumpMode-String. */
const JUMP_MODE_TO_ABLESET: Record<JumpMode, string> = {
  quantized: 'quantized',
  endOfSection: 'end-of-section',
  endOfSong: 'end-of-song',
  dynamic: 'dynamic',
  manual: 'manual',
};
const JUMP_MODE_FROM_ABLESET: Record<string, JumpMode> = {
  quantized: 'quantized',
  'end-of-section': 'endOfSection',
  'end-of-song': 'endOfSong',
  dynamic: 'dynamic',
  manual: 'manual',
};

type OscArg = OscTypedArg;
const S = (value: string): OscArg => ({ type: 's', value });
const I = (value: number): OscArg => ({ type: 'i', value: Math.round(value) });
const F = (value: number): OscArg => ({ type: 'f', value });
const B = (value: boolean): OscArg => ({ type: value ? 'T' : 'F', value });

interface Subscriber {
  address: string;
  port: number;
  fineUpdates: boolean;
}

interface OscMsg {
  address: string;
  args: OscArg[];
}

export interface AblesetCompatOptions {
  port?: number;
  log?: (message: string) => void;
}

export class AblesetCompatServer {
  private readonly port: number;
  private readonly log: (message: string) => void;
  private udp: UDPPort | null = null;
  private ready = false;
  private keepalive: NodeJS.Timeout | null = null;
  /** key `address:port` → Subscriber */
  private readonly subscribers = new Map<string, Subscriber>();

  constructor(
    private readonly store: HostStore,
    private readonly engine: SetlistEngine,
    private readonly bridge: AbletonBridge,
    options: AblesetCompatOptions = {},
  ) {
    this.port = options.port ?? ABLESET_DEFAULT_PORT;
    this.log = options.log ?? (() => {});
  }

  async open(): Promise<void> {
    const udp = new osc.UDPPort({
      localAddress: '0.0.0.0',
      localPort: this.port,
      metadata: true,
    });
    this.udp = udp;
    udp.on('message', (packet, _timeTag, info) => this.onMessage(packet, info));
    udp.on('error', (error) => this.log(`AbleSet-Compat-Fehler: ${error.message}`));
    await new Promise<void>((resolve, reject) => {
      udp.once('ready', () => {
        this.ready = true;
        resolve();
      });
      udp.once('error', reject);
      udp.open();
    });
    this.log(`AbleSet-Companion-Kompatibilität aktiv auf UDP :${this.port}`);

    // State-Änderungen an alle Subscriber pushen
    this.store.on('broadcast', this.onStoreBroadcast);

    // Keepalive < 3 s, damit das Companion-Modul die Verbindung nicht als
    // verloren markiert, wenn gerade nichts passiert.
    this.keepalive = setInterval(() => {
      if (this.subscribers.size === 0) return;
      const state = this.store.getSnapshot();
      this.sendToAll([{ address: '/global/isPlaying', args: [B(state.transport.isPlaying)] }]);
    }, 1000);
  }

  close(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    this.store.off('broadcast', this.onStoreBroadcast);
    if (this.udp && this.ready) {
      try {
        this.udp.close();
      } catch {
        // Shutdown
      }
    }
    this.udp = null;
    this.ready = false;
    this.subscribers.clear();
  }

  // --- Store → Companion --------------------------------------------------------

  private onStoreBroadcast = (message: { type: string }): void => {
    if (this.subscribers.size === 0) return;
    const state = this.store.getSnapshot();
    if (message.type === 'transport') {
      this.sendToAll(this.positionValues(state));
    } else if (
      message.type === 'songs' ||
      message.type === 'setlists' ||
      message.type === 'engine' ||
      message.type === 'tracks' ||
      message.type === 'bridge'
    ) {
      this.sendToAll([...this.structureValues(state), ...this.positionValues(state)]);
    }
  };

  // --- Companion → Store --------------------------------------------------------

  private onMessage(packet: OscPacket, info: RemoteInfo): void {
    const address = packet.address;
    const args = packet.args.map((arg) => arg.value);
    const timeSig = this.store.getTransport().timeSig;

    // --- Handshake ---
    if (address === '/subscribe') {
      // ['auto', <port>, 'Companion', <fineUpdates>]
      const portArg = args.find((value) => typeof value === 'number');
      const clientPort = typeof portArg === 'number' ? portArg : info.port;
      const fineUpdates = args.some((value) => value === true);
      const key = `${info.address}:${clientPort}`;
      this.subscribers.set(key, { address: info.address, port: clientPort, fineUpdates });
      this.log(`AbleSet-Client abonniert: ${key}`);
      this.sendTo({ address: info.address, port: clientPort, fineUpdates }, this.allValues());
      return;
    }
    if (address === '/getValues') {
      const existing = [...this.subscribers.values()].find((sub) => sub.address === info.address);
      const target = existing ?? { address: info.address, port: info.port, fineUpdates: false };
      this.sendTo(target, this.allValues());
      return;
    }
    if (address === '/unsubscribe') {
      for (const [key, sub] of this.subscribers) {
        if (sub.address === info.address) this.subscribers.delete(key);
      }
      return;
    }

    // --- Transport ---
    switch (address) {
      case '/global/play':
        this.bridge.play();
        return;
      case '/global/pause':
      case '/global/stop':
        this.bridge.stop();
        return;
      case '/global/record':
      case '/global/stopRecording':
      case '/global/toggleRecording':
        // UnableSet steuert keine Aufnahme über die Bridge — ignorieren
        this.log(`AbleSet-Compat: ${address} nicht unterstützt (Record)`);
        return;
      case '/global/syncToRemoteTick':
        return;
    }

    // --- Setlist-Navigation & Jumps ---
    if (address === '/setlist/jumpToSong') {
      this.jumpToSong(args[0], timeSig);
      return;
    }
    if (address === '/setlist/jumpBySongs') {
      const delta = typeof args[0] === 'number' ? args[0] : 0;
      const force = args[1] === true || args[1] === 'true';
      this.jumpBySongs(delta, force, timeSig);
      return;
    }
    if (address === '/setlist/jumpToSection') {
      this.jumpToSection(args[0], timeSig);
      return;
    }
    if (address === '/setlist/jumpBySections') {
      const delta = typeof args[0] === 'number' ? args[0] : 0;
      const force = args[1] === true || args[1] === 'true';
      this.jumpBySections(delta, force, timeSig);
      return;
    }
    if (address === '/setlist/playCuedSong') {
      this.engine.jumpNow(timeSig);
      return;
    }
    if (address === '/setlist/enableLoop') {
      this.loopCurrentSection(true);
      return;
    }
    if (address === '/setlist/escapeLoop') {
      this.loopCurrentSection(false);
      return;
    }

    // --- Settings ---
    if (address.startsWith('/settings/')) {
      this.applySetting(address.slice('/settings/'.length), args[0]);
      return;
    }

    // --- Mixer: /mixer/<gruppe>/<typ> → Track per Name ---
    const mixerMatch = address.match(/^\/mixer\/(.+)\/(mute|muted|solo|soloed|toggleMute|toggleSolo)$/);
    if (mixerMatch) {
      this.applyMixer(mixerMatch[1], mixerMatch[2], args[0]);
      return;
    }

    // /audioInterfaces/* : keine steuerbare 1:1-Entsprechung → still ignorieren
  }

  private trackByName(name: string): { index: number; mute: boolean; solo: boolean } | undefined {
    const wanted = name.toLowerCase();
    return this.store
      .getSnapshot()
      .tracks.find((track) => track.name.toLowerCase() === wanted);
  }

  private applyMixer(group: string, type: string, value: unknown): void {
    const track = this.trackByName(group);
    if (!track) return;
    const isSolo = type.toLowerCase().includes('solo');
    const isToggle = type.startsWith('toggle') || value === 'toggle';
    const target = isToggle ? !(isSolo ? track.solo : track.mute) : value === 1 || value === true;
    if (isSolo) this.bridge.setTrackSolo(track.index, target);
    else this.bridge.setTrackMute(track.index, target);
  }

  // --- Kommando-Umsetzung -------------------------------------------------------

  private playableEntries(state: HostState) {
    const setlist = state.setlists.find((candidate) => candidate.id === state.activeSetlistId);
    if (!setlist) return [];
    return setlist.entries.filter((entry) => {
      const song = this.engine.resolvedSong(entry);
      return song !== undefined && song.skip !== true;
    });
  }

  private currentEntryIndex(state: HostState): number {
    const entries = this.playableEntries(state);
    const byCurrent = entries.findIndex(
      (entry) => entry.entryId === state.engine.currentEntryId,
    );
    if (byCurrent >= 0) return byCurrent;
    // Fallback über die Position
    const song = findSongAtBeat(state.songs, state.transport.positionBeats);
    return entries.findIndex((entry) => entry.songId === song?.id);
  }

  private jumpToSong(arg: unknown, timeSig: [number, number]): void {
    const state = this.store.getSnapshot();
    const entries = this.playableEntries(state);
    let index = -1;
    if (typeof arg === 'number') {
      index = arg - JUMP_POSITION_BASE;
    } else if (typeof arg === 'string') {
      if (arg.toUpperCase() === 'RANDOM') {
        // deterministisch genug: nächster nach dem aktuellen (kein Math.random nötig)
        index = (this.currentEntryIndex(state) + 1) % Math.max(1, entries.length);
      } else {
        index = entries.findIndex(
          (entry) => this.engine.resolvedSong(entry)?.title.toLowerCase() === arg.toLowerCase(),
        );
      }
    }
    const entry = entries[index];
    if (entry) this.engine.queue(entry.songId, entry.entryId, undefined, timeSig);
  }

  private jumpBySongs(delta: number, force: boolean, timeSig: [number, number]): void {
    const state = this.store.getSnapshot();
    const entries = this.playableEntries(state);
    const target = this.currentEntryIndex(state) + delta;
    const entry = entries[Math.max(0, Math.min(entries.length - 1, target))];
    if (!entry) return;
    this.engine.queue(entry.songId, entry.entryId, undefined, timeSig);
    if (force) this.engine.jumpNow(timeSig);
  }

  private jumpToSection(arg: unknown, timeSig: [number, number]): void {
    const state = this.store.getSnapshot();
    const song = findSongAtBeat(state.songs, state.transport.positionBeats);
    if (!song) return;
    let section: Section | undefined;
    if (typeof arg === 'number') {
      section = song.sections[arg - JUMP_POSITION_BASE];
    } else if (typeof arg === 'string') {
      section = song.sections.find((candidate) => candidate.name.toLowerCase() === arg.toLowerCase());
    }
    if (section) this.engine.queue(song.id, undefined, section.id, timeSig);
  }

  private jumpBySections(delta: number, force: boolean, timeSig: [number, number]): void {
    const state = this.store.getSnapshot();
    const song = findSongAtBeat(state.songs, state.transport.positionBeats);
    if (!song || song.sections.length === 0) return;
    const current = sectionAtBeat(song, state.transport.positionBeats);
    const currentIndex = current ? song.sections.findIndex((s) => s.id === current.id) : 0;
    const target = Math.max(0, Math.min(song.sections.length - 1, currentIndex + delta));
    const section = song.sections[target];
    if (!section) return;
    this.engine.queue(song.id, undefined, section.id, timeSig);
    if (force) this.engine.jumpNow(timeSig);
  }

  private loopCurrentSection(enabled: boolean): void {
    const state = this.store.getSnapshot();
    const song = findSongAtBeat(state.songs, state.transport.positionBeats);
    const section = song ? sectionAtBeat(song, state.transport.positionBeats) : undefined;
    if (song && section) this.engine.loopSection(song.id, section.id, enabled);
  }

  private applySetting(name: string, value: unknown): void {
    const on = value === 1 || value === true || value === 'true' || value === 'toggle';
    switch (name) {
      case 'safeMode':
        this.engine.setSafeMode(value === 'toggle' ? !this.engine.getState().safeMode : on);
        break;
      case 'removePlayedSongs':
        this.engine.setHidePlayed(value === 'toggle' ? !this.engine.getState().hidePlayed : on);
        break;
      case 'jumpMode':
        if (typeof value === 'string' && JUMP_MODE_FROM_ABLESET[value]) {
          this.engine.setJumpMode(JUMP_MODE_FROM_ABLESET[value]);
        }
        break;
      default:
        // autoplay/alwaysStopOnSongEnd/… haben in UnableSet keine globale
        // Entsprechung (Autoplay ist pro Song) — still ignorieren.
        break;
    }
  }

  // --- Werte-Ableitung (UnableSet-State → AbleSet-Adressen) ---------------------

  private allValues(): OscMsg[] {
    const state = this.store.getSnapshot();
    return [...this.structureValues(state), ...this.positionValues(state)];
  }

  /** Struktur-Werte: ändern sich selten (Setlist/Songs/Settings/Loop). */
  private structureValues(state: HostState): OscMsg[] {
    const setlist = state.setlists.find((candidate) => candidate.id === state.activeSetlistId);
    const entries = this.playableEntries(state);
    const song = findSongAtBeat(state.songs, state.transport.positionBeats);
    const songTitles = entries.map((entry) => this.engine.resolvedSong(entry)?.title ?? '');
    const sectionNames = song ? song.sections.map((section) => section.name) : [];
    const sectionColors = song
      ? song.sections.map((section) => section.color ?? '#888888')
      : [];
    const engine = state.engine;

    const msgs: OscMsg[] = [
      { address: '/setlist/name', args: [S(setlist?.name ?? '')] },
      { address: '/setlist/songs', args: songTitles.map(S) },
      { address: '/setlist/sections', args: sectionNames.map(S) },
      { address: '/setlist/sectionColors', args: sectionColors.map(S) },
      { address: '/settings/jumpMode', args: [S(JUMP_MODE_TO_ABLESET[engine.jumpMode])] },
      { address: '/settings/safeMode', args: [B(engine.safeMode)] },
      { address: '/settings/removePlayedSongs', args: [B(engine.hidePlayed)] },
      { address: '/setlist/loopEnabled', args: [B(Boolean(engine.loopSectionId))] },
      { address: '/global/tempo', args: [F(state.transport.bpm)] },
      { address: '/global/timeSignature', args: [I(state.transport.timeSig[0]), I(state.transport.timeSig[1])] },
      // Redundanz-Interfaces: „verbunden", wenn die Bridge steht
      { address: '/audioInterfaces/connected', args: [B(state.bridge.connected)] },
      { address: '/audioInterfaces/all/scene', args: [I(0)] },
    ];

    // Mixer: pro Track muted/soloed unter dem Track-Namen (AbleSet-Gruppen)
    for (const track of state.tracks) {
      msgs.push({ address: `/mixer/${track.name}/muted`, args: [B(track.mute)] });
      msgs.push({ address: `/mixer/${track.name}/soloed`, args: [B(track.solo)] });
    }

    // Loop-Grenzen der aktiven Section
    if (engine.loopSectionId && song) {
      const looped = song.sections.find((section) => section.id === engine.loopSectionId);
      if (looped) {
        msgs.push({ address: '/setlist/loopStart', args: [F(looped.startBeat)] });
        msgs.push({
          address: '/setlist/loopEnd',
          args: [F(looped.startBeat + looped.lengthBeats)],
        });
      }
    }
    return msgs;
  }

  /** Positions-Werte: ändern sich laufend (Transport/aktiver Song/Queue/Restzeit). */
  private positionValues(state: HostState): OscMsg[] {
    const transport = state.transport;
    const { bar, beat } = beatsToBarBeat(transport.positionBeats, transport.timeSig);
    const entries = this.playableEntries(state);
    const song = findSongAtBeat(state.songs, transport.positionBeats);
    const section = song ? sectionAtBeat(song, transport.positionBeats) : undefined;
    const activeIndex = this.currentEntryIndex(state);

    const songRemainingBeats = song
      ? Math.max(0, song.startBeat + song.lengthBeats - transport.positionBeats)
      : 0;
    let setRemainingBeats = songRemainingBeats;
    for (let i = activeIndex + 1; i >= 0 && i < entries.length; i++) {
      const s = this.engine.resolvedSong(entries[i]);
      if (s && !state.engine.playedEntryIds.includes(entries[i].entryId)) {
        setRemainingBeats += s.lengthBeats;
      }
    }

    const queued = state.engine.queued;
    const queuedSong = queued ? state.songs.find((s) => s.id === queued.songId) : undefined;
    const queuedSection = queued?.sectionId
      ? queuedSong?.sections.find((s) => s.id === queued.sectionId)
      : undefined;
    const queuedIndex = queued
      ? entries.findIndex((entry) => entry.songId === queued.songId)
      : -1;

    const perBar = quarterBeatsPerBar(transport.timeSig);
    const measure = Math.floor(transport.positionBeats / perBar) + 1;

    const msgs: OscMsg[] = [
      { address: '/global/beatsPosition', args: [F(transport.positionBeats)] },
      { address: '/global/finePosition', args: [F(transport.positionBeats)] },
      { address: '/global/humanPosition', args: [I(bar), I(beat)] },
      { address: '/global/currentMeasure', args: [I(measure), I(bar), I(beat)] },
      { address: '/global/isPlaying', args: [B(transport.isPlaying)] },
      { address: '/global/isRecording', args: [B(transport.isRecording)] },
      { address: '/global/isSyncingPlayback', args: [B(false)] },
      { address: '/setlist/isCountingIn', args: [B(false)] },
      { address: '/global/tempo', args: [F(transport.bpm)] },
      {
        address: '/setlist/activeSongName',
        args: [S(song?.title ?? '')],
      },
      {
        address: '/setlist/activeSongIndex',
        args: [I(activeIndex < 0 ? -1 : activeIndex + ACTIVE_INDEX_BASE)],
      },
      { address: '/setlist/activeSongStart', args: [F(song?.startBeat ?? 0)] },
      {
        address: '/setlist/activeSongEnd',
        args: [F(song ? song.startBeat + song.lengthBeats : 0)],
      },
      { address: '/setlist/activeSectionName', args: [S(section?.name ?? '')] },
      {
        address: '/setlist/activeSectionIndex',
        args: [
          I(
            section && song
              ? song.sections.findIndex((s) => s.id === section.id) + ACTIVE_INDEX_BASE
              : -1,
          ),
        ],
      },
      { address: '/setlist/activeSectionStart', args: [F(section?.startBeat ?? 0)] },
      {
        address: '/setlist/activeSectionEnd',
        args: [F(section ? section.startBeat + section.lengthBeats : 0)],
      },
      {
        address: '/setlist/queuedName',
        args: [S(queuedSong?.title ?? ''), S(queuedSection?.name ?? '')],
      },
      {
        address: '/setlist/queuedIndex',
        args: [I(queuedIndex >= 0 ? queuedIndex + ACTIVE_INDEX_BASE : -1), I(-1)],
      },
      {
        address: '/setlist/remainingTimeInSong',
        args: [F(beatsToSeconds(songRemainingBeats, transport.bpm))],
      },
      {
        address: '/setlist/remainingTimeInSet',
        args: [F(beatsToSeconds(setRemainingBeats, transport.bpm))],
      },
      { address: '/timecode/tc', args: [S(this.timecode(transport.positionBeats, transport.bpm))] },
      { address: '/timecode/fps', args: [S('30')] },
      { address: '/timecode/stale', args: [B(!transport.isPlaying)] },
    ];
    return msgs;
  }

  private timecode(beats: number, bpm: number): string {
    const totalSeconds = beatsToSeconds(beats, bpm);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const f = Math.floor((totalSeconds % 1) * 30);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
  }

  // --- Senden -------------------------------------------------------------------

  private sendTo(sub: Subscriber, messages: OscMsg[]): void {
    if (!this.udp || !this.ready) return;
    for (const message of messages) {
      try {
        this.udp.send({ address: message.address, args: message.args }, sub.address, sub.port);
      } catch {
        // best effort — ein totes Ziel darf nichts blockieren
      }
    }
  }

  private sendToAll(messages: OscMsg[]): void {
    for (const sub of this.subscribers.values()) this.sendTo(sub, messages);
  }

  /** Test-Helfer: aktuelle Subscriber-Anzahl. */
  subscriberCount(): number {
    return this.subscribers.size;
  }
}
