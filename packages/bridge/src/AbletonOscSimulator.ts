/**
 * AbletonOSC-Simulator: bildet die vom Host genutzte Teilmenge des
 * AbletonOSC-Protokolls über echtes UDP nach — inklusive laufendem Transport,
 * Loop-Bracket und Mixer-Tracks.
 *
 * Einsatz: Entwicklung ohne Live, Headless-E2E-Tests, Screenshots.
 * Die produktive Bridge (OscAbletonBridge) läuft dagegen unverändert wie
 * gegen ein echtes Ableton Live.
 */

import osc from 'osc';
import type { OscPacket, OscTypedArg, RemoteInfo, UDPPort } from 'osc';
import { OSC_ADDR } from '@unableset/shared';

export interface SimulatorTrack {
  name: string;
  volume: number;
  mute: boolean;
  solo: boolean;
}

export interface AbletonOscSimulatorOptions {
  port: number;
  tempo?: number;
  timeSig?: [number, number];
  /** [Name, Zeit in Beats] — dieselbe Notation wie echte Ableton-Locators. */
  cuePoints?: [string, number][];
  songLengthBeats?: number;
  tracks?: SimulatorTrack[];
  liveVersion?: [number, number];
}

const S = (value: string): OscTypedArg => ({ type: 's', value });
const I = (value: number): OscTypedArg => ({ type: 'i', value });
const F = (value: number): OscTypedArg => ({ type: 'f', value });

interface Listener {
  address: string;
  port: number;
}

export class AbletonOscSimulator {
  private readonly port: UDPPort;
  private readonly opts: Required<AbletonOscSimulatorOptions>;

  tempo: number;
  timeSig: [number, number];
  cuePoints: [string, number][];
  songLengthBeats: number;
  tracks: SimulatorTrack[];

  isPlaying = false;
  positionBeats = 0;
  loop = { start: 0, length: 4, enabled: false };

  private tickTimer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private readonly listeners = new Map<string, Map<string, Listener>>();
  private closed = false;

  constructor(options: AbletonOscSimulatorOptions) {
    this.opts = {
      port: options.port,
      tempo: options.tempo ?? 120,
      timeSig: options.timeSig ?? [4, 4],
      cuePoints: options.cuePoints ?? [],
      songLengthBeats: options.songLengthBeats ?? 256,
      tracks: options.tracks ?? [],
      liveVersion: options.liveVersion ?? [12, 1],
    };
    this.tempo = this.opts.tempo;
    this.timeSig = [...this.opts.timeSig];
    this.cuePoints = this.opts.cuePoints.map(([name, time]) => [name, time]);
    this.songLengthBeats = this.opts.songLengthBeats;
    this.tracks = this.opts.tracks.map((track) => ({ ...track }));

    this.port = new osc.UDPPort({
      localAddress: '127.0.0.1',
      localPort: options.port,
      metadata: true,
    });
    this.port.on('message', (msg, _timeTag, info) => this.onMessage(msg, info));
    this.port.on('error', () => {
      // Simulator: UDP-Fehler ignorieren
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.port.once('ready', resolve);
      this.port.open();
    });
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this.tick(), 50);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.port.close();
  }

  /** Transport-Fortschritt in Echtzeit + Loop-Verhalten wie Lives Loop-Bracket. */
  private tick(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    if (!this.isPlaying) return;

    this.positionBeats += (elapsedSec * this.tempo) / 60;
    if (this.loop.enabled && this.positionBeats >= this.loop.start + this.loop.length) {
      this.positionBeats -= this.loop.length;
    }
    if (this.positionBeats >= this.songLengthBeats) {
      this.positionBeats = this.songLengthBeats;
      this.setPlaying(false);
    }
  }

  private setPlaying(isPlaying: boolean): void {
    if (this.isPlaying === isPlaying) return;
    this.isPlaying = isPlaying;
    this.pushToListeners('is_playing', [I(isPlaying ? 1 : 0)]);
  }

  setTempo(tempo: number): void {
    this.tempo = tempo;
    this.pushToListeners('tempo', [F(tempo)]);
  }

  private pushToListeners(prop: string, args: OscTypedArg[]): void {
    const registered = this.listeners.get(prop);
    if (!registered) return;
    const address = `/live/song/get/${prop}`;
    for (const listener of registered.values()) {
      this.port.send({ address, args }, listener.address, listener.port);
    }
  }

  private onMessage(msg: OscPacket, info: RemoteInfo): void {
    const reply = (address: string, args: OscTypedArg[]) =>
      this.port.send({ address, args }, info.address, info.port);
    const arg = (index: number): unknown => msg.args[index]?.value;

    // Change-Listener registrieren/abmelden
    const listenMatch = msg.address.match(/^\/live\/song\/(start|stop)_listen\/(.+)$/);
    if (listenMatch) {
      const [, verb, prop] = listenMatch;
      const key = `${info.address}:${info.port}`;
      if (verb === 'start') {
        const registered = this.listeners.get(prop) ?? new Map<string, Listener>();
        registered.set(key, { address: info.address, port: info.port });
        this.listeners.set(prop, registered);
      } else {
        this.listeners.get(prop)?.delete(key);
      }
      return;
    }

    switch (msg.address) {
      case OSC_ADDR.test:
        reply(OSC_ADDR.test, [S('ok')]);
        break;
      case OSC_ADDR.application.getVersion:
        reply(msg.address, [I(this.opts.liveVersion[0]), I(this.opts.liveVersion[1])]);
        break;

      // --- Song: Getter ---
      case OSC_ADDR.song.getTempo:
        reply(msg.address, [F(this.tempo)]);
        break;
      case OSC_ADDR.song.getIsPlaying:
        reply(msg.address, [I(this.isPlaying ? 1 : 0)]);
        break;
      case OSC_ADDR.song.getCurrentSongTime:
        reply(msg.address, [F(this.positionBeats)]);
        break;
      case OSC_ADDR.song.getSongLength:
        reply(msg.address, [F(this.songLengthBeats)]);
        break;
      case OSC_ADDR.song.getSignatureNumerator:
        reply(msg.address, [I(this.timeSig[0])]);
        break;
      case OSC_ADDR.song.getSignatureDenominator:
        reply(msg.address, [I(this.timeSig[1])]);
        break;
      case OSC_ADDR.song.getNumTracks:
        reply(msg.address, [I(this.tracks.length)]);
        break;
      case OSC_ADDR.song.getCuePoints:
        reply(
          msg.address,
          this.cuePoints.flatMap(([name, time]) => [S(name), F(time)]),
        );
        break;

      // --- Song: Transport ---
      case OSC_ADDR.song.startPlaying:
        this.setPlaying(true);
        break;
      case OSC_ADDR.song.stopPlaying:
        this.setPlaying(false);
        break;
      case OSC_ADDR.song.continuePlaying:
        this.setPlaying(true);
        break;
      case OSC_ADDR.song.cuePointJump: {
        const target = arg(0);
        const cue =
          typeof target === 'number'
            ? this.cuePoints[target]
            : this.cuePoints.find(([name]) => name === target);
        if (cue) this.positionBeats = cue[1];
        break;
      }
      case OSC_ADDR.song.setCurrentSongTime: {
        const value = arg(0);
        if (typeof value === 'number') this.positionBeats = value;
        break;
      }

      // --- Loop-Bracket ---
      case OSC_ADDR.song.setLoop: {
        this.loop.enabled = arg(0) === 1 || arg(0) === true;
        break;
      }
      case OSC_ADDR.song.setLoopStart: {
        const value = arg(0);
        if (typeof value === 'number') this.loop.start = value;
        break;
      }
      case OSC_ADDR.song.setLoopLength: {
        const value = arg(0);
        if (typeof value === 'number' && value > 0) this.loop.length = value;
        break;
      }

      // --- Tracks / Mixer ---
      case OSC_ADDR.track.getName: {
        const index = arg(0);
        if (typeof index === 'number' && this.tracks[index]) {
          reply(msg.address, [I(index), S(this.tracks[index].name)]);
        }
        break;
      }
      case OSC_ADDR.track.getVolume: {
        const index = arg(0);
        if (typeof index === 'number' && this.tracks[index]) {
          reply(msg.address, [I(index), F(this.tracks[index].volume)]);
        }
        break;
      }
      case OSC_ADDR.track.getMute: {
        const index = arg(0);
        if (typeof index === 'number' && this.tracks[index]) {
          reply(msg.address, [I(index), I(this.tracks[index].mute ? 1 : 0)]);
        }
        break;
      }
      case OSC_ADDR.track.getSolo: {
        const index = arg(0);
        if (typeof index === 'number' && this.tracks[index]) {
          reply(msg.address, [I(index), I(this.tracks[index].solo ? 1 : 0)]);
        }
        break;
      }
      case OSC_ADDR.track.setVolume: {
        const index = arg(0);
        const value = arg(1);
        if (typeof index === 'number' && typeof value === 'number' && this.tracks[index]) {
          this.tracks[index].volume = value;
        }
        break;
      }
      case OSC_ADDR.track.setMute: {
        const index = arg(0);
        if (typeof index === 'number' && this.tracks[index]) {
          this.tracks[index].mute = arg(1) === 1 || arg(1) === true;
        }
        break;
      }
      case OSC_ADDR.track.setSolo: {
        const index = arg(0);
        if (typeof index === 'number' && this.tracks[index]) {
          this.tracks[index].solo = arg(1) === 1 || arg(1) === true;
        }
        break;
      }

      default:
        break;
    }
  }
}

/**
 * Skalierungs-Szenario: viele Songs mit Sections (Default ~2000 Cue Points)
 * für Performance-Tests der Clients.
 */
export function bigSimulatorOptions(port: number, songCount = 400): AbletonOscSimulatorOptions {
  const cuePoints: [string, number][] = [];
  const songLengthBeats = 32;
  for (let i = 0; i < songCount; i++) {
    const start = i * songLengthBeats;
    cuePoints.push([`Song ${String(i + 1).padStart(3, '0')} {Demo}`, start]);
    cuePoints.push(['>Verse', start]);
    cuePoints.push(['>Chorus', start + 8]);
    cuePoints.push(['>Bridge', start + 16]);
    cuePoints.push(['>Outro', start + 24]);
  }
  return {
    port,
    tempo: 120,
    timeSig: [4, 4],
    songLengthBeats: songCount * songLengthBeats,
    cuePoints,
    tracks: [
      { name: 'Click', volume: 0.85, mute: false, solo: false },
      { name: 'Playback', volume: 0.85, mute: false, solo: false },
    ],
  };
}

/** Demo-Session: 4 Songs mit Sections, Markern und Mixer-Tracks. */
export function demoSimulatorOptions(port: number): AbletonOscSimulatorOptions {
  return {
    port,
    tempo: 122,
    timeSig: [4, 4],
    songLengthBeats: 640,
    cuePoints: [
      ['Neonlicht {Opener, Click ab Takt 1}', 0],
      ['>Intro', 0],
      ['>Verse 1', 16],
      ['>Chorus', 48],
      ['>Verse 2', 80],
      ['>Chorus 2', 112],
      ['*FX Blitz', 120],
      ['Sturmfahrt {Capo 2}', 144],
      ['>Intro', 144],
      ['>Drop +LOOP:4', 176],
      ['>Outro', 224],
      ['STOP', 256],
      ['Herzschlag {Ballade}', 288],
      ['>Verse', 288],
      ['>Bridge', 336],
      ['>Finale', 368],
      ['SONG END', 400],
      ['Zugabe: Feuerwerk', 448],
      ['>Chorus-Schleife +LOOP:8', 480],
    ],
    tracks: [
      { name: 'Click', volume: 0.85, mute: false, solo: false },
      { name: 'Guides', volume: 0.8, mute: false, solo: false },
      { name: 'Playback L', volume: 0.85, mute: false, solo: false },
      { name: 'Playback R', volume: 0.85, mute: false, solo: false },
      { name: 'Synth Stems', volume: 0.7, mute: false, solo: false },
      { name: 'Timecode', volume: 1.0, mute: false, solo: false },
    ],
  };
}
