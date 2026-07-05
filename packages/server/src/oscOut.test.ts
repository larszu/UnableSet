/**
 * OSC-Out-Test: Der Host sendet Song-/Section-/Playing-Feed und
 * oscOnEnter-Nachrichten an einen UDP-Listener (simuliertes Floor-Display).
 */

import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import osc from 'osc';
import type { OscPacket, UDPPort } from 'osc';
import { OSC_OUT, serializeMessage } from '@unableset/shared';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { createHostApp, type HostApp } from './hostApp.js';
import { FakeBridge } from './testUtil.js';

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

function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor-Timeout'));
      }
    }, 20);
  });
}

describe('OscOut (Floor-Display-Feed)', () => {
  let app: HostApp | null = null;
  let listener: UDPPort | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    ws = null;
    listener?.close();
    listener = null;
    await app?.close();
    app = null;
  });

  it('sendet Playing-, Song-, Next- und oscOnEnter-Nachrichten', async () => {
    const displayPort = await freeUdpPort();
    const received: OscPacket[] = [];
    listener = new osc.UDPPort({ localAddress: '127.0.0.1', localPort: displayPort, metadata: true });
    listener.on('message', (packet: OscPacket) => received.push(packet));
    await new Promise<void>((resolve) => {
      listener!.once('ready', resolve);
      listener!.open();
    });

    const bridge = new FakeBridge();
    bridge.cuePoints = [
      { name: 'Alpha', timeBeats: 0 },
      { name: 'Beta', timeBeats: 64 },
    ];
    app = createHostApp({
      bridge,
      serverVersion: 'test',
      oscOutTargets: [{ address: '127.0.0.1', port: displayPort }],
    });
    await app.ready;
    await new Promise<void>((resolve) => app!.httpServer.listen(0, resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    // Songs laden
    bridge.emit('songLength', 128);
    bridge.emit('cuePoints', bridge.cuePoints);

    // oscOnEnter an Song Beta hängen (via Setlist-Override)
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws!.on('open', () => resolve()));
    const setlist = app.store.getActiveSetlist();
    ws.send(
      serializeMessage({
        type: 'setlistUpdate',
        setlist: {
          ...setlist,
          entries: setlist.entries.map((entry, index) =>
            index === 1
              ? {
                  ...entry,
                  overrides: { oscOnEnter: [{ address: '/light/preset', args: [7, 'warm'] }] },
                }
              : entry,
          ),
        },
      }),
    );
    await waitFor(() => {
      const entries = app!.store.getActiveSetlist().entries;
      return entries[1]?.overrides?.oscOnEnter !== undefined;
    });

    // Transport: Play in Song Alpha → playing=1 + Song-Feed
    bridge.transport = { isPlaying: true, positionBeats: 1, bpm: 120, timeSig: [4, 4] };
    bridge.emit('transport', bridge.getTransport());

    await waitFor(() => received.some((p) => p.address === OSC_OUT.playing));
    await waitFor(() => received.some((p) => p.address === OSC_OUT.song));

    const songMsg = received.find((p) => p.address === OSC_OUT.song)!;
    expect(songMsg.args.map((a) => a.value)).toEqual([0, 'Alpha']);
    const nextMsg = received.find((p) => p.address === OSC_OUT.next)!;
    expect(nextMsg.args.map((a) => a.value)).toEqual(['Beta']);

    // In Song Beta wechseln → oscOnEnter feuert
    bridge.transport = { isPlaying: true, positionBeats: 65, bpm: 120, timeSig: [4, 4] };
    bridge.emit('transport', bridge.getTransport());

    await waitFor(() => received.some((p) => p.address === '/light/preset'));
    const lightMsg = received.find((p) => p.address === '/light/preset')!;
    expect(lightMsg.args.map((a) => a.value)).toEqual([7, 'warm']);

    const songMessages = received.filter((p) => p.address === OSC_OUT.song);
    expect(songMessages[songMessages.length - 1].args.map((a) => a.value)).toEqual([1, 'Beta']);
  });
});
