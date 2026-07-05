import { create } from 'zustand';
import {
  INITIAL_ENGINE,
  INITIAL_TRANSPORT,
  songWithOverrides,
  type BridgeStatus,
  type ClockRule,
  type EngineState,
  type MirrorTargetStatus,
  type ServerMessage,
  type Setlist,
  type SetlistEntry,
  type Song,
  type TrackInfo,
  type TransportState,
} from '@unableset/shared';

export type ConnectionState = 'connecting' | 'open' | 'closed';
export type ViewTab = 'performance' | 'setlist' | 'lyrics' | 'mixer' | 'settings';

/** Pro Gerät gespeicherte, unkritische Präferenzen (localStorage). */
interface LocalPrefs {
  view: ViewTab;
  locked: boolean;
  ttsEnabled: boolean;
}

const PREFS_KEY = 'unableset-prefs';

function loadPrefs(): LocalPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { view: 'performance', locked: false, ttsEnabled: false, ...JSON.parse(raw) };
  } catch {
    // localStorage kann fehlen (Private Mode) — Defaults reichen
  }
  return { view: 'performance', locked: false, ttsEnabled: false };
}

function savePrefs(prefs: LocalPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // unkritisch
  }
}

interface AppState {
  connection: ConnectionState;
  latencyMs: number | null;
  serverVersion: string | null;
  bridge: BridgeStatus | null;
  transport: TransportState;
  songs: Song[];
  setlists: Setlist[];
  activeSetlistId: string;
  engine: EngineState;
  tracks: TrackInfo[];
  clockRules: ClockRule[];
  mirrors: MirrorTargetStatus[];

  view: ViewTab;
  locked: boolean;
  ttsEnabled: boolean;

  setConnection(connection: ConnectionState): void;
  setLatency(latencyMs: number): void;
  applyServerMessage(message: ServerMessage): void;
  setView(view: ViewTab): void;
  setLocked(locked: boolean): void;
  setTtsEnabled(enabled: boolean): void;
}

const prefs = loadPrefs();

export const useAppStore = create<AppState>((set, get) => ({
  connection: 'connecting',
  latencyMs: null,
  serverVersion: null,
  bridge: null,
  transport: INITIAL_TRANSPORT,
  songs: [],
  setlists: [],
  activeSetlistId: 'default',
  engine: INITIAL_ENGINE,
  tracks: [],
  clockRules: [],
  mirrors: [],

  view: prefs.view,
  locked: prefs.locked,
  ttsEnabled: prefs.ttsEnabled,

  setConnection: (connection) => set({ connection }),
  setLatency: (latencyMs) => set({ latencyMs }),

  applyServerMessage: (message) => {
    switch (message.type) {
      case 'snapshot':
        set({
          serverVersion: message.state.serverVersion,
          bridge: message.state.bridge,
          transport: message.state.transport,
          songs: message.state.songs,
          setlists: message.state.setlists,
          activeSetlistId: message.state.activeSetlistId,
          engine: message.state.engine,
          tracks: message.state.tracks,
          clockRules: message.state.clockRules,
          mirrors: message.state.mirrors,
        });
        break;
      case 'transport':
        set({ transport: message.transport });
        break;
      case 'songs':
        set({ songs: message.songs });
        break;
      case 'setlists':
        set({ setlists: message.setlists, activeSetlistId: message.activeSetlistId });
        break;
      case 'engine':
        set({ engine: message.engine });
        break;
      case 'tracks':
        set({ tracks: message.tracks });
        break;
      case 'clockRules':
        set({ clockRules: message.rules });
        break;
      case 'bridge':
        set({ bridge: message.bridge });
        break;
      case 'mirrors':
        set({ mirrors: message.mirrors });
        break;
      case 'pong':
        break;
    }
  },

  setView: (view) => {
    set({ view });
    const { locked, ttsEnabled } = get();
    savePrefs({ view, locked, ttsEnabled });
  },
  setLocked: (locked) => {
    set({ locked });
    const { view, ttsEnabled } = get();
    savePrefs({ view, locked, ttsEnabled });
  },
  setTtsEnabled: (ttsEnabled) => {
    set({ ttsEnabled });
    const { view, locked } = get();
    savePrefs({ view, locked, ttsEnabled });
  },
}));

// ---------------------------------------------------------------------------
// Abgeleitete Selektoren
// ---------------------------------------------------------------------------

export function selectActiveSetlist(state: AppState): Setlist | undefined {
  return state.setlists.find((setlist) => setlist.id === state.activeSetlistId);
}

export function selectSongById(state: AppState, songId: string | undefined): Song | undefined {
  return songId ? state.songs.find((song) => song.id === songId) : undefined;
}

/** Song eines Eintrags inkl. Overrides. */
export function resolveEntry(state: AppState, entry: SetlistEntry): Song | undefined {
  const song = selectSongById(state, entry.songId);
  return song ? songWithOverrides(song, entry) : undefined;
}

export function selectCurrentEntry(state: AppState): SetlistEntry | undefined {
  const setlist = selectActiveSetlist(state);
  return setlist?.entries.find((entry) => entry.entryId === state.engine.currentEntryId);
}

/** Verbleibende Beats: Rest des aktuellen Songs + alle folgenden spielbaren Einträge. */
export function selectRemainingBeats(state: AppState): number {
  const setlist = selectActiveSetlist(state);
  if (!setlist) return 0;
  const entries = setlist.entries.filter((entry) => {
    const song = resolveEntry(state, entry);
    return song && song.skip !== true;
  });
  const currentIndex = entries.findIndex(
    (entry) => entry.entryId === state.engine.currentEntryId,
  );

  let remaining = 0;
  const currentSong = selectSongById(state, state.transport.currentSongId);
  if (currentSong) {
    remaining += Math.max(
      0,
      currentSong.startBeat + currentSong.lengthBeats - state.transport.positionBeats,
    );
  }
  for (let i = currentIndex + 1; i < entries.length; i++) {
    if (currentIndex < 0) break;
    const song = resolveEntry(state, entries[i]);
    if (song && !state.engine.playedEntryIds.includes(entries[i].entryId)) {
      remaining += song.lengthBeats;
    }
  }
  return remaining;
}

export function selectTotalBeats(state: AppState): number {
  const setlist = selectActiveSetlist(state);
  if (!setlist) return 0;
  return setlist.entries.reduce((sum, entry) => {
    const song = resolveEntry(state, entry);
    return song && song.skip !== true ? sum + song.lengthBeats : sum;
  }, 0);
}
