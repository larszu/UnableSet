/**
 * Integrationstest der OSC-Bridge gegen einen simulierten AbletonOSC-Endpunkt
 * (echtes UDP auf localhost). Der Simulator existiert nur im Test — die
 * Bridge selbst läuft unverändert wie gegen ein echtes Live.
 */

import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import osc from 'osc';
import type { OscPacket, RemoteInfo, UDPPort } from 'osc';
import { OscAbletonBridge } from './OscAbletonBridge.js';
import type { CuePoint } from '@unableset/shared';
import type { BridgeStatus } from '@unableset/shared';

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

/** Minimaler AbletonOSC-Simulator: beantwortet die vom Host genutzten Adressen. */
class FakeAbletonOsc {
  port: UDPPort;
  cuePoints: [string, number][] = [
    ['Intro', 0],
    ['*Ignore me', 16],
    ['Main Song {mit Click}', 32],
    ['STOP', 96],
  ];
  tempo = 122.5;

  constructor(listenPort: number) {
    this.port = new osc.UDPPort({ localAddress: '127.0.0.1', localPort: listenPort, metadata: true });
    this.port.on('message', (msg: OscPacket, _timeTag: unknown, info: RemoteInfo) => {
      const reply = (address: string, args: { type: string; value: unknown }[]) =>
        this.port.send({ address, args }, info.address, info.port);

      switch (msg.address) {
        case '/live/test':
          reply('/live/test', [{ type: 's', value: 'ok' }]);
          break;
        case '/live/application/get/version':
          reply('/live/application/get/version', [
            { type: 'i', value: 12 },
            { type: 'i', value: 1 },
          ]);
          break;
        case '/live/song/get/tempo':
          reply('/live/song/get/tempo', [{ type: 'f', value: this.tempo }]);
          break;
        case '/live/song/get/is_playing':
          reply('/live/song/get/is_playing', [{ type: 'i', value: 0 }]);
          break;
        case '/live/song/get/current_song_time':
          reply('/live/song/get/current_song_time', [{ type: 'f', value: 0 }]);
          break;
        case '/live/song/get/song_length':
          reply('/live/song/get/song_length', [{ type: 'f', value: 128 }]);
          break;
        case '/live/song/get/signature_numerator':
          reply('/live/song/get/signature_numerator', [{ type: 'i', value: 4 }]);
          break;
        case '/live/song/get/signature_denominator':
          reply('/live/song/get/signature_denominator', [{ type: 'i', value: 4 }]);
          break;
        case '/live/song/get/cue_points':
          reply(
            '/live/song/get/cue_points',
            this.cuePoints.flatMap(([name, time]) => [
              { type: 's', value: name },
              { type: 'f', value: time },
            ]),
          );
          break;
        default:
          // start_listen/... und Transportbefehle brauchen keine Antwort
          break;
      }
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.port.once('ready', resolve);
      this.port.open();
    });
  }

  private closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.port.close();
  }
}

describe('OscAbletonBridge (Integration, UDP localhost)', () => {
  let bridge: OscAbletonBridge | null = null;
  let fake: FakeAbletonOsc | null = null;

  afterEach(async () => {
    await bridge?.disconnect();
    bridge = null;
    fake?.close();
    fake = null;
  });

  async function setup(): Promise<{ bridge: OscAbletonBridge; fake: FakeAbletonOsc }> {
    const fakePort = await freeUdpPort();
    const localPort = await freeUdpPort();
    fake = new FakeAbletonOsc(fakePort);
    await fake.open();
    bridge = new OscAbletonBridge({
      remoteAddress: '127.0.0.1',
      remotePort: fakePort,
      localPort,
      heartbeatMs: 200,
      heartbeatTimeoutMs: 400,
      requestTimeoutMs: 400,
    });
    return { bridge, fake };
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
    expect(cuePoints).toEqual([
      { name: 'Intro', timeBeats: 0 },
      { name: '*Ignore me', timeBeats: 16 },
      { name: 'Main Song {mit Click}', timeBeats: 32 },
      { name: 'STOP', timeBeats: 96 },
    ]);

    expect(await songLengthPromise).toBe(128);

    // Tempo kommt asynchron über die State-Updates herein
    await waitFor<void>((resolve) => {
      const check = () => {
        if (bridge.getTransport().bpm === 122.5) resolve();
      };
      bridge.on('transport', check);
      check();
    });
  });

  it('meldet Verbindungsverlust, wenn Live nicht mehr antwortet', async () => {
    const { bridge, fake } = await setup();
    await bridge.connect();

    await waitFor<void>((resolve) => {
      bridge.on('status', (status) => {
        if (status.connected) resolve();
      });
    });

    const disconnected = waitFor<BridgeStatus>((resolve) => {
      bridge.on('status', (status) => {
        if (!status.connected) resolve(status);
      });
    });

    fake.close();
    const status = await disconnected;
    expect(status.connected).toBe(false);
  });

  it('sendet Transportbefehle an Live', async () => {
    const { bridge, fake } = await setup();

    const received: string[] = [];
    fake.port.on('message', (msg: OscPacket) => {
      received.push(msg.address);
    });

    await bridge.connect();
    await waitFor<void>((resolve) => {
      bridge.on('status', (status) => {
        if (status.connected) resolve();
      });
    });

    bridge.play();
    bridge.stop();
    bridge.continuePlayback();
    bridge.jumpToCuePoint(2);

    await waitFor<void>((resolve) => {
      const timer = setInterval(() => {
        if (received.includes('/live/song/cue_point/jump')) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });

    expect(received).toContain('/live/song/start_playing');
    expect(received).toContain('/live/song/stop_playing');
    expect(received).toContain('/live/song/continue_playing');
  });
});
