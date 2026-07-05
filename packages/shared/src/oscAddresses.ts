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
    getSongLength: '/live/song/get/song_length',
    getCuePoints: '/live/song/get/cue_points',
    getSignatureNumerator: '/live/song/get/signature_numerator',
    getSignatureDenominator: '/live/song/get/signature_denominator',
    startPlaying: '/live/song/start_playing',
    stopPlaying: '/live/song/stop_playing',
    continuePlaying: '/live/song/continue_playing',
    cuePointJump: '/live/song/cue_point/jump',
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
