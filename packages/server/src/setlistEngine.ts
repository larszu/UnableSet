/**
 * Setlist-/Jump-Engine — das Herzstück von M2/M3.
 *
 * Verantwortlich für: Queue + Jump-Modi (quantized/endOfSection/endOfSong/
 * dynamic/manual), Safe Mode, Autoplay/STOP/SONG-END-Verhalten über die
 * *Setlist-Reihenfolge* (nicht die Arrangement-Reihenfolge), Pre-Roll,
 * Played-Tracking und Section-Loops (Ableton-Loop-Bracket).
 *
 * Die Grenz-Mathematik lebt als reine Funktionen in @unableset/shared
 * (jump.ts) und ist dort unit-getestet; hier lebt die Zustandsmaschine.
 */

import { EventEmitter } from 'node:events';
import {
  INITIAL_ENGINE,
  crossedBoundary,
  findSongAtBeat,
  jumpBoundaryFor,
  jumpTargetBeats,
  songWithOverrides,
  type EngineState,
  type JumpMode,
  type Section,
  type Setlist,
  type SetlistEntry,
  type Song,
  type SongId,
} from '@unableset/shared';
import type { AbletonBridge, BridgeTransport } from '@unableset/bridge';

export interface SetlistEngineEvents {
  changed: [EngineState];
}

const EPSILON = 1e-6;

export class SetlistEngine extends EventEmitter<SetlistEngineEvents> {
  private state: EngineState = { ...INITIAL_ENGINE, playedEntryIds: [] };
  private songs: Song[] = [];
  private setlist: Setlist = { id: 'default', name: 'Alle Songs', entries: [] };
  private prevPositionBeats = 0;
  private inTick = false;

  constructor(
    private readonly bridge: AbletonBridge,
    private readonly log: (message: string) => void = () => {},
  ) {
    super();
  }

  // -------------------------------------------------------------------------
  // Zustand & Lookups
  // -------------------------------------------------------------------------

  getState(): EngineState {
    return { ...this.state, playedEntryIds: [...this.state.playedEntryIds] };
  }

  restoreSettings(settings: Partial<Pick<EngineState, 'jumpMode' | 'safeMode' | 'preRollBars' | 'hidePlayed'>>): void {
    this.state = { ...this.state, ...settings };
    this.emitChanged();
  }

  setSongs(songs: Song[]): void {
    this.songs = songs;
  }

  setActiveSetlist(setlist: Setlist): void {
    this.setlist = setlist;
    const validIds = new Set(setlist.entries.map((entry) => entry.entryId));
    this.state.playedEntryIds = this.state.playedEntryIds.filter((id) => validIds.has(id));
    if (this.state.currentEntryId && !validIds.has(this.state.currentEntryId)) {
      delete this.state.currentEntryId;
    }
    if (this.state.queued?.entryId && !validIds.has(this.state.queued.entryId)) {
      delete this.state.queued;
    }
    this.emitChanged();
  }

  private songById(songId: SongId): Song | undefined {
    return this.songs.find((song) => song.id === songId);
  }

  private entryById(entryId: string | undefined): SetlistEntry | undefined {
    if (!entryId) return undefined;
    return this.setlist.entries.find((entry) => entry.entryId === entryId);
  }

  /** Song eines Eintrags inkl. Setlist-Overrides. */
  resolvedSong(entry: SetlistEntry): Song | undefined {
    const song = this.songById(entry.songId);
    return song ? songWithOverrides(song, entry) : undefined;
  }

  /** Spielbare Einträge (ohne skip); Reihenfolge = Setlist. */
  private playableEntries(): SetlistEntry[] {
    return this.setlist.entries.filter((entry) => {
      const song = this.resolvedSong(entry);
      return song !== undefined && song.skip !== true;
    });
  }

  private entryIndexOf(entryId: string | undefined): number {
    if (!entryId) return -1;
    return this.playableEntries().findIndex((entry) => entry.entryId === entryId);
  }

  private nextEntryAfter(entryId: string | undefined): SetlistEntry | undefined {
    const entries = this.playableEntries();
    const index = this.entryIndexOf(entryId);
    return entries[index + 1];
  }

  private prevEntryBefore(entryId: string | undefined): SetlistEntry | undefined {
    const entries = this.playableEntries();
    const index = this.entryIndexOf(entryId);
    return index > 0 ? entries[index - 1] : undefined;
  }

  /** Ordnet eine Song-Position dem passenden Setlist-Eintrag zu. */
  private syncCurrentEntry(positionBeats: number): void {
    const song = findSongAtBeat(this.songs, positionBeats);
    if (!song) return;
    const current = this.entryById(this.state.currentEntryId);
    if (current && current.songId === song.id) return;
    // Bevorzugt einen noch nicht gespielten Eintrag mit diesem Song
    const entries = this.playableEntries().filter((entry) => entry.songId === song.id);
    const target =
      entries.find((entry) => !this.state.playedEntryIds.includes(entry.entryId)) ?? entries[0];
    if (target && target.entryId !== this.state.currentEntryId) {
      this.state.currentEntryId = target.entryId;
      this.emitChanged();
    }
  }

  // -------------------------------------------------------------------------
  // Kommandos
  // -------------------------------------------------------------------------

  setJumpMode(mode: JumpMode): void {
    this.state.jumpMode = mode;
    this.emitChanged();
  }

  setSafeMode(enabled: boolean): void {
    this.state.safeMode = enabled;
    this.emitChanged();
  }

  setPreRoll(bars: number): void {
    this.state.preRollBars = Math.max(0, Math.min(8, Math.round(bars)));
    this.emitChanged();
  }

  setHidePlayed(enabled: boolean): void {
    this.state.hidePlayed = enabled;
    this.emitChanged();
  }

  markPlayed(entryId: string, played: boolean): void {
    const set = new Set(this.state.playedEntryIds);
    if (played) set.add(entryId);
    else set.delete(entryId);
    this.state.playedEntryIds = [...set];
    this.emitChanged();
  }

  /**
   * Song/Section cuen. Bei stehendem Transport wird sofort positioniert;
   * bei laufendem Transport entscheidet der Jump-Modus (tick()).
   */
  queue(songId: SongId, entryId?: string, sectionId?: string, timeSig: [number, number] = [4, 4]): void {
    const song = this.songById(songId);
    if (!song) {
      this.log(`Queue: unbekannter Song ${songId}`);
      return;
    }
    this.state.queued = { songId, ...(entryId ? { entryId } : {}), ...(sectionId ? { sectionId } : {}) };
    this.emitChanged();

    if (!this.bridge.getTransport().isPlaying) {
      this.executeQueuedJump(timeSig);
    }
  }

  clearQueue(): void {
    if (!this.state.queued) return;
    delete this.state.queued;
    this.emitChanged();
  }

  /**
   * Gequeueten Sprung sofort ausführen. Im Safe Mode bei laufendem Playback
   * blockiert (nur der quantisierte Weg bleibt) — gegen versehentliche Sprünge.
   */
  jumpNow(timeSig: [number, number] = [4, 4]): boolean {
    if (!this.state.queued) return false;
    if (this.state.safeMode && this.bridge.getTransport().isPlaying) {
      this.log('Safe Mode aktiv — sofortiger Sprung blockiert');
      return false;
    }
    this.executeQueuedJump(timeSig);
    return true;
  }

  nextSong(timeSig: [number, number] = [4, 4]): void {
    const next = this.nextEntryAfter(this.currentOrPositionEntryId());
    if (next) this.queue(next.songId, next.entryId, undefined, timeSig);
  }

  prevSong(timeSig: [number, number] = [4, 4]): void {
    const prev = this.prevEntryBefore(this.currentOrPositionEntryId());
    if (prev) this.queue(prev.songId, prev.entryId, undefined, timeSig);
  }

  private currentOrPositionEntryId(): string | undefined {
    if (this.state.currentEntryId) return this.state.currentEntryId;
    const song = findSongAtBeat(this.songs, this.bridge.getTransport().positionBeats);
    return this.playableEntries().find((entry) => entry.songId === song?.id)?.entryId;
  }

  /** Section-Loop: legt das Ableton-Loop-Bracket um die Section. */
  loopSection(songId: SongId, sectionId: string, enabled: boolean): void {
    const song = this.songById(songId);
    const section = song?.sections.find((candidate) => candidate.id === sectionId);
    if (!song || !section) return;
    if (enabled) {
      this.bridge.setLoop(section.startBeat, section.lengthBeats, true);
      this.state.loopSectionId = sectionId;
    } else {
      this.bridge.setLoopEnabled(false);
      delete this.state.loopSectionId;
    }
    this.emitChanged();
  }

  private clearSectionLoop(): void {
    if (!this.state.loopSectionId) return;
    this.bridge.setLoopEnabled(false);
    delete this.state.loopSectionId;
  }

  // -------------------------------------------------------------------------
  // Tick (aus Bridge-Transport-Events)
  // -------------------------------------------------------------------------

  handleTransportTick(transport: BridgeTransport): void {
    if (this.inTick) return; // setSongPosition emittiert synchron erneut
    this.inTick = true;
    try {
      const prev = this.prevPositionBeats;
      const now = transport.positionBeats;
      this.prevPositionBeats = now;
      let jumped = false;

      if (transport.isPlaying) {
        // 1) Gequeueter Sprung an der Modus-Grenze
        if (this.state.queued) {
          const currentSong = findSongAtBeat(this.songs, prev);
          const boundary = jumpBoundaryFor(
            this.state.jumpMode,
            prev,
            transport.timeSig,
            currentSong,
          );
          if (boundary !== null && crossedBoundary(prev, now, boundary)) {
            this.executeQueuedJump(transport.timeSig);
            jumped = true;
          }
        }

        // 2) Songende erreicht → Autoplay/STOP über die Setlist-Reihenfolge
        if (!jumped) {
          const song = findSongAtBeat(this.songs, prev);
          if (song) {
            const end = song.startBeat + song.lengthBeats;
            if (crossedBoundary(prev, now, end)) {
              const entry = this.entryForSong(song.id);
              const resolved = entry ? (this.resolvedSong(entry) ?? song) : song;
              this.handleSongEnd(resolved, entry);
              jumped = true;
            }
          }
        }
      }

      // Erst NACH der Grenz-Behandlung den Eintrag zur Position syncen —
      // sonst würde der Arrangement-Nachbar die Setlist-Reihenfolge kapern.
      if (!jumped) this.syncCurrentEntry(now);
    } finally {
      this.inTick = false;
    }
  }

  /** Eintrag, der gerade „dran" ist: currentEntry, wenn er zum Song passt. */
  private entryForSong(songId: SongId): SetlistEntry | undefined {
    const current = this.entryById(this.state.currentEntryId);
    if (current && current.songId === songId) return current;
    const candidates = this.playableEntries().filter((entry) => entry.songId === songId);
    return (
      candidates.find((entry) => !this.state.playedEntryIds.includes(entry.entryId)) ??
      candidates[0]
    );
  }

  private handleSongEnd(song: Song, entry: SetlistEntry | undefined): void {
    if (entry) this.markPlayed(entry.entryId, true);
    this.clearSectionLoop();

    const next = this.nextEntryAfter(entry?.entryId ?? this.currentOrPositionEntryId());
    const nextSong = next ? this.resolvedSong(next) : undefined;
    const songEnd = song.startBeat + song.lengthBeats;

    if (song.stopAfter || !song.autoplayNext) {
      this.bridge.stop();
      if (nextSong && next) {
        // Nächsten Song vorbereiten (Playhead ans Ziel, ohne zu starten)
        this.teleport(nextSong.startBeat);
        this.state.currentEntryId = next.entryId;
      }
      this.emitChanged();
      return;
    }

    if (!next || !nextSong) {
      // Ende der Setlist
      this.bridge.stop();
      this.log('Setlist zu Ende — Stop');
      this.emitChanged();
      return;
    }

    this.state.currentEntryId = next.entryId;
    if (Math.abs(nextSong.startBeat - songEnd) > EPSILON) {
      // Setlist-Reihenfolge weicht vom Arrangement ab (oder SONG-END-Lücke)
      this.teleport(nextSong.startBeat);
    }
    this.emitChanged();
  }

  private executeQueuedJump(timeSig: [number, number]): void {
    const queued = this.state.queued;
    if (!queued) return;
    const song = this.songById(queued.songId);
    if (!song) {
      delete this.state.queued;
      this.emitChanged();
      return;
    }
    const section: Section | undefined = queued.sectionId
      ? song.sections.find((candidate) => candidate.id === queued.sectionId)
      : undefined;
    const target = jumpTargetBeats(song, section, section ? this.state.preRollBars : 0, timeSig);

    this.clearSectionLoop();
    this.teleport(target);
    if (queued.entryId) this.state.currentEntryId = queued.entryId;
    else {
      const match = this.playableEntries().find((candidate) => candidate.songId === song.id);
      if (match) this.state.currentEntryId = match.entryId;
    }
    delete this.state.queued;
    this.emitChanged();
  }

  /** Position setzen, ohne dass der eigene Grenz-Check den Sprung doppelt sieht. */
  private teleport(beats: number): void {
    this.prevPositionBeats = beats;
    this.bridge.setSongPosition(beats);
  }

  private emitChanged(): void {
    this.emit('changed', this.getState());
  }
}
