/**
 * Integrationstest der OSC-Bridge gegen den AbletonOSC-Simulator
 * (echtes UDP auf localhost). Die Bridge läuft unverändert wie gegen ein
 * echtes Ableton Live.
 */

import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { OscAbletonBridge } from './OscAbletonBridge.js';
import { AbletonOscSimulator } from './AbletonOscSimulator.js';
import type { CuePoint, BridgeStatus, TrackInfo } from '@unableset/shared';

async function freeUdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

describe('OscAbletonBridge (Integration, UDP localhost)', () => {
  let bridge: OscAbletonBridge | null = null;
  let simulator: AbletonOscSimulator | null = null;

  afterEach(async () => {
    await bridge?.disconnect();
    bridge = null;
    simulator?.close();
    simulator = null;
  });

  async function setup(): Promise<{ bridge: OscAbletonBridge; simulator: AbletonOscSimulator }> {
    const simPort = await freeUdpPort();
    const localPort = await freeUdpPort();
    simulator = new AbletonOscSimulator({
      port: simPort,
      tempo: 122.5,
      cuePoints: [
        ['Intro', 0],
        ['*Ignore me', 16],
        ['Main Song {mit Click}', 32],
        ['>Drop', 48],
        ['STOP', 96],
      ],
      songLengthBeats: 128,
      liveVersion: [12, 1],
      tracks: [
        { name: 'Click', volume: 0.85, mute: false, solo: false },
        { name: 'Playback', volume: 0.7, mute: true, solo: false },
      ],
    });
    await simulator.open();
    bridge = new OscAbletonBridge({
      remoteAddress: '127.0.0.1',
      remotePort: simPort,
      localPort,
      heartbeatMs: 200,
      heartbeatTimeoutMs: 400,
      requestTimeoutMs: 400,
    });
    return { bridge, simulator };
  }

  function waitFor<T>(run: (resolve: (value: T) => void) => void, timeoutMs = 3000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor-Timeout')), timeoutMs);
      run((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  function waitForConnected(bridge: OscAbletonBridge): Promise<void> {
    return waitFor<void>((resolve) => {
      if (bridge.getStatus().connected) return resolve();
      bridge.on('status', (status) => {
        if (status.connected) resolve();
      });
    });
  }

  it('verbindet sich, liest Version, Tempo und Cue Points', async () => {
    const { bridge } = await setup();

    const statusPromise = waitFor<BridgeStatus>((resolve) => {
      bridge.on('status', (status) => {
        if (status.connected) resolve(status);
      });
    });
    const cuePointsPromise = waitFor<CuePoint[]>((resolve) => {
      bridge.on('cuePoints', resolve);
    });
    const songLengthPromise = waitFor<number>((resolve) => {
      bridge.on('songLength', resolve);
    });

    await bridge.connect();

    const status = await statusPromise;
    expect(status.connected).toBe(true);

    const cuePoints = await cuePointsPromise;
    expect(cuePoints.map((c) => c.name)).toEqual([
      'Intro',
      '*Ignore me',
      'Main Song {mit Click}',
      '>Drop',
      'STOP',
    ]);

    expect(await songLengthPromise).toBe(128);

    await waitFor<void>((resolve) => {
      const check = () => {
        if (bridge.getTransport().bpm === 122.5) resolve();
      };
      bridge.on('transport', check);
      check();
    });
  });

  it('meldet Verbindungsverlust, wenn Live nicht mehr antwortet', async () => {
    const { bridge, simulator } = await setup();
    await bridge.connect();
    await waitForConnected(bridge);

    const disconnected = waitFor<BridgeStatus>((resolve) => {
      bridge.on('status', (status) => {
        if (!status.connected) resolve(status);
      });
    });

    simulator.close();
    const status = await disconnected;
    expect(status.connected).toBe(false);
  });

  it('steuert den simulierten Transport (Play/Position/Stop)', async () => {
    const { bridge, simulator } = await setup();
    await bridge.connect();
    await waitForConnected(bridge);

    bridge.setSongPosition(32);
    bridge.play();
    await waitFor<void>((resolve) => {
      bridge.on('transport', (transport) => {
        if (transport.isPlaying && transport.positionBeats > 32) resolve();
      });
    });
    expect(simulator.isPlaying).toBe(true);
    expect(simulator.positionBeats).toBeGreaterThan(32);

    bridge.stop();
    await waitFor<void>((resolve) => {
      bridge.on('transport', (transport) => {
        if (!transport.isPlaying) resolve();
      });
    });
    expect(simulator.isPlaying).toBe(false);
  });

  it('liest und steuert Mixer-Tracks', async () => {
    const { bridge, simulator } = await setup();
    await bridge.connect();
    await waitForConnected(bridge);

    const tracks: TrackInfo[] = await bridge.refreshTracks();
    expect(tracks.map((t) => [t.index, t.name, t.mute, t.solo])).toEqual([
      [0, 'Click', false, false],
      [1, 'Playback', true, false],
    ]);
    // OSC-Floats sind 32-bit — nur näherungsweise vergleichen
    expect(tracks[0].volume).toBeCloseTo(0.85, 5);
    expect(tracks[1].volume).toBeCloseTo(0.7, 5);

    bridge.setTrackVolume(0, 0.5);
    bridge.setTrackMute(1, false);
    bridge.setTrackSolo(0, true);

    await waitFor<void>((resolve) => {
      const timer = setInterval(() => {
        if (simulator.tracks[0].volume === 0.5 && !simulator.tracks[1].mute) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
    expect(simulator.tracks[0].solo).toBe(true);
  });

  it('setzt das Loop-Bracket für Section-Loops', async () => {
    const { bridge, simulator } = await setup();
    await bridge.connect();
    await waitForConnected(bridge);

    bridge.setLoop(48, 16, true);
    await waitFor<void>((resolve) => {
      const timer = setInterval(() => {
        if (simulator.loop.enabled) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
    expect(simulator.loop).toEqual({ start: 48, length: 16, enabled: true });

    bridge.setLoopEnabled(false);
    await waitFor<void>((resolve) => {
      const timer = setInterval(() => {
        if (!simulator.loop.enabled) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
  });
});
