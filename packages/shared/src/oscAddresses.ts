/**
 * OSC-Adressen der Ableton-Bridge (Weg A).
 *
 * Die Bridge spricht das Adressschema von AbletonOSC
 * (https://github.com/ideoforms/AbletonOSC, MIT-Lizenz) — ein quelloffenes
 * MIDI-Remote-Script, das das Live Object Model per OSC/UDP exponiert.
 * Standard-Ports: Live lauscht auf 11000, Antworten gehen an Port 11001.
 */

export const ABLETON_OSC_DEFAULT_SEND_PORT = 11000;
export const ABLETON_OSC_DEFAULT_RECEIVE_PORT = 11001;

export const OSC_ADDR = {
  /** Handshake/Heartbeat — antwortet mit 'ok'. */
  test: '/live/test',
  application: {
    getVersion: '/live/application/get/version',
  },
  song: {
    getTempo: '/live/song/get/tempo',
    getIsPlaying: '/live/song/get/is_playing',
    getCurrentSongTime: '/live/song/get/current_song_time',
    setCurrentSongTime: '/live/song/set/current_song_time',
    getSongLength: '/live/song/get/song_length',
    getCuePoints: '/live/song/get/cue_points',
    getSignatureNumerator: '/live/song/get/signature_numerator',
    getSignatureDenominator: '/live/song/get/signature_denominator',
    getNumTracks: '/live/song/get/num_tracks',
    startPlaying: '/live/song/start_playing',
    stopPlaying: '/live/song/stop_playing',
    continuePlaying: '/live/song/continue_playing',
    cuePointJump: '/live/song/cue_point/jump',
    setLoop: '/live/song/set/loop',
    setLoopStart: '/live/song/set/loop_start',
    setLoopLength: '/live/song/set/loop_length',
  },
  track: {
    getName: '/live/track/get/name',
    getVolume: '/live/track/get/volume',
    setVolume: '/live/track/set/volume',
    getMute: '/live/track/get/mute',
    setMute: '/live/track/set/mute',
    getSolo: '/live/track/get/solo',
    setSolo: '/live/track/set/solo',
  },
} as const;

/** Properties, für die die Bridge Change-Listener bei AbletonOSC registriert. */
export const OSC_LISTEN_PROPS = [
  'tempo',
  'is_playing',
  'signature_numerator',
  'signature_denominator',
] as const;

export function oscStartListen(prop: string): string {
  return `/live/song/start_listen/${prop}`;
}

export function oscStopListen(prop: string): string {
  return `/live/song/stop_listen/${prop}`;
}

// ---------------------------------------------------------------------------
// OSC-Fernsteuerung des Hosts (OSC-In, z. B. TouchOSC / Bitfocus Companion)
// ---------------------------------------------------------------------------

export const OSC_REMOTE_DEFAULT_PORT = 9000;

/** Adressen, auf die der Host selbst per OSC hört. */
export const OSC_REMOTE = {
  play: '/unableset/play',
  stop: '/unableset/stop',
  continue: '/unableset/continue',
  nextSong: '/unableset/next',
  prevSong: '/unableset/prev',
  jumpNow: '/unableset/jump',
  /** Arg: Setlist-Eintrags-Index (int, 0-basiert) → cuet den Song. */
  queueEntry: '/unableset/queue',
  setSafeMode: '/unableset/safemode',
} as const;
