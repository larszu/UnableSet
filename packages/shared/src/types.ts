/**
 * Zentrales Datenmodell — Single Source of Truth für Host und Clients.
 * Alle Beat-Angaben sind in Ableton-Beats (Viertelnoten, `song_time`).
 */

export type SongId = string;

export interface MidiNoteMessage {
  type: 'noteOn' | 'noteOff' | 'cc' | 'programChange';
  channel: number;
  data1: number;
  data2?: number;
}

export interface MidiSysexMessage {
  type: 'sysex';
  bytes: number[];
}

export type MidiMessage = MidiNoteMessage | MidiSysexMessage;

export type OscArgValue = number | string | boolean;

export interface OscMessage {
  address: string;
  args?: OscArgValue[];
}

export interface SectionLoop {
  enabled: boolean;
  count?: number | 'infinite';
  mode: 'standard' | 'full';
}

export interface Section {
  id: string;
  name: string;
  startBeat: number;
  lengthBeats: number;
  color?: string;
  loop?: SectionLoop;
  guideTracks?: string[];
}

/** Zeitlich verankerte Lyric-Zeile (aus MIDI-Clips auf Lyrics-Tracks). */
export interface TimedLyricLine {
  /** Absolute Position in Beats (Clip-Start im Arrangement). */
  beat: number;
  text: string;
}

export interface Song {
  id: SongId;
  title: string;
  description?: string;
  tags: string[];
  color?: string;
  notes?: string;
  /** Lyrics/Chords als Text; Zeilen mit führendem "." werden als Akkordzeile gerendert. */
  lyrics?: string;
  /** Beat-synchronisierte Lyrics aus MIDI-Clips (Tracks namens "Lyrics…"). */
  timedLyrics?: TimedLyricLine[];
  startBeat: number;
  lengthBeats: number;
  bpm?: number;
  timeSig?: [number, number];
  sections: Section[];
  autoplayNext: boolean;
  stopAfter: boolean;
  preRollBars?: number;
  transpose?: number;
  midiOnEnter?: MidiMessage[];
  oscOnEnter?: OscMessage[];
  skip?: boolean;
}

export interface SetlistEntry {
  entryId: string;
  songId: SongId;
  overrides?: Partial<Song>;
  setGroup?: string;
}

export interface Setlist {
  id: string;
  name: string;
  /** Songs dürfen mehrfach vorkommen — Identität über entryId. */
  entries: SetlistEntry[];
  /** „Gig hat mehrere Sets": Gruppierung der Einträge. */
  sets?: { name: string; entryIds: string[] }[];
  showPreset?: string;
}

export interface TransportState {
  isPlaying: boolean;
  isRecording: boolean;
  positionBeats: number;
  bar: number;
  beat: number;
  bpm: number;
  timeSig: [number, number];
  currentSongId?: SongId;
  currentSectionId?: string;
  queuedSongId?: SongId;
  queuedSectionId?: string;
}

export type JumpMode = 'quantized' | 'endOfSection' | 'endOfSong' | 'dynamic' | 'manual';

export const JUMP_MODES: JumpMode[] = ['quantized', 'endOfSection', 'endOfSong', 'dynamic', 'manual'];

export type ViewRole = 'md' | 'musician' | 'singer' | 'crew' | 'solo';

/** Roh-Daten eines Ableton-Locators (Cue Point), wie von der Bridge geliefert. */
export interface CuePoint {
  name: string;
  timeBeats: number;
}

export interface BridgeStatus {
  kind: 'osc';
  connected: boolean;
  remoteAddress: string;
  remotePort: number;
  liveVersion?: string;
  lastHeartbeatAt?: number;
}

/** Ableton-Track im Mixer (Auszug des Live Object Model). */
export interface TrackInfo {
  index: number;
  name: string;
  /** 0..1 (Live-Mixer-Skala) */
  volume: number;
  mute: boolean;
  solo: boolean;
}

/** Geplanter Sprung (Queue) — Song und optional Section. */
export interface QueuedJump {
  songId: SongId;
  /** Eintrag in der aktiven Setlist, falls über die Setlist gecuet. */
  entryId?: string;
  sectionId?: string;
}

/** Zustand der Setlist-/Jump-Engine des Hosts. */
export interface EngineState {
  jumpMode: JumpMode;
  safeMode: boolean;
  preRollBars: number;
  hidePlayed: boolean;
  queued?: QueuedJump;
  /** Aktiver Eintrag der Setlist (bestimmt „nächster Song" bei Autoplay). */
  currentEntryId?: string;
  playedEntryIds: string[];
  /** Section-Loop aktiv? (Ableton-Loop-Bracket um die Section gelegt) */
  loopSectionId?: string;
}

/** Status eines gespiegelten Backup-Rigs (M6-Redundanz). */
export interface MirrorTargetStatus {
  address: string;
  port: number;
  connected: boolean;
  /** Zuletzt gemessene Positions-Abweichung zum Haupt-Rig (Beats). */
  driftBeats?: number;
  /** Anzahl automatischer Drift-Korrekturen seit Start. */
  corrections: number;
}

/** Fernsteuer-Aktion (MIDI-Mapping, OSC-Remote, Canvas-Buttons). */
export type RemoteActionName =
  | 'play'
  | 'stop'
  | 'continue'
  | 'nextSong'
  | 'prevSong'
  | 'jumpNow';

export interface MidiMappingInfo {
  event: 'noteOn' | 'cc' | 'programChange';
  channel: number;
  data1: number;
  threshold?: number;
  action: RemoteActionName;
}

/** Zustand des MIDI-Subsystems (Hardware optional). */
export interface MidiState {
  /** Hardware-Modul geladen und Input geöffnet? */
  available: boolean;
  inputName?: string;
  mappings: MidiMappingInfo[];
  /** Learn-Modus aktiv für diese Aktion (wartet auf das nächste Event). */
  learning?: RemoteActionName;
  /** Zuletzt empfangenes Event (Anzeige beim Lernen). */
  lastEvent?: { status: number; data1: number; data2: number };
}

/** Registrierte Live-Projektdatei (Multi-File-Workflow). */
export interface ProjectFileInfo {
  name: string;
  path: string;
}

/** Uhrzeit-basierte Aktion („um 20:00 → Play"). */
export interface ClockRule {
  id: string;
  /** "HH:MM" (lokale Zeit des Hosts) */
  at: string;
  action: 'play' | 'stop' | 'continue' | 'nextSong';
  enabled: boolean;
}

/** Vollständiger Host-Zustand — geht als Snapshot an jeden (re)verbundenen Client. */
export interface HostState {
  serverVersion: string;
  bridge: BridgeStatus;
  transport: TransportState;
  songs: Song[];
  setlists: Setlist[];
  activeSetlistId: string;
  engine: EngineState;
  tracks: TrackInfo[];
  clockRules: ClockRule[];
  mirrors: MirrorTargetStatus[];
  midi: MidiState;
  projects: ProjectFileInfo[];
  /** Geteilter Key-Value-Store für Canvas-Scripte (shared()/setShared()). */
  shared: Record<string, string | number | boolean>;
}

export const INITIAL_MIDI: MidiState = { available: false, mappings: [] };

export const INITIAL_TRANSPORT: TransportState = {
  isPlaying: false,
  isRecording: false,
  positionBeats: 0,
  bar: 1,
  beat: 1,
  bpm: 120,
  timeSig: [4, 4],
};

export const INITIAL_ENGINE: EngineState = {
  jumpMode: 'quantized',
  safeMode: false,
  preRollBars: 0,
  hidePlayed: false,
  playedEntryIds: [],
};

/** Wendet Setlist-Overrides auf einen Song an (Projekt bleibt unangetastet). */
export function songWithOverrides(song: Song, entry: SetlistEntry | undefined): Song {
  if (!entry?.overrides) return song;
  const merged: Song = { ...song };
  for (const [key, value] of Object.entries(entry.overrides)) {
    if (value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}
