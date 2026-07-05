/**
 * WebSocket-Roundtrip-Test: Snapshot bei Connect, Ping/Pong, Broadcast bei
 * Bridge-Events, Kommandos erreichen Bridge und Engine. Die Bridge ist hier
 * ein In-Memory-Fake (Mocks sind nur in Tests erlaubt).
 */

import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  WS_PATH,
  parseServerMessage,
  serializeMessage,
  type ServerMessage,
} from '@unableset/shared';
import { createHostApp, type HostApp } from './hostApp.js';
import { FakeBridge } from './testUtil.js';

interface TestClient {
  socket: WebSocket;
  messages: ServerMessage[];
  next(predicate: (msg: ServerMessage) => boolean): Promise<ServerMessage>;
}

function connectClient(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
    const messages: ServerMessage[] = [];
    const waiters: {
      predicate: (msg: ServerMessage) => boolean;
      resolve: (m: ServerMessage) => void;
    }[] = [];

    socket.on('message', (data) => {
      const message = parseServerMessage(data.toString());
      if (!message) return;
      messages.push(message);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(message)) {
          const [waiter] = waiters.splice(i, 1);
          waiter.resolve(message);
        }
      }
    });
    socket.on('open', () =>
      resolve({
        socket,
        messages,
        next: (predicate) =>
          new Promise((resolveNext, rejectNext) => {
            const existing = messages.find(predicate);
            if (existing) return resolveNext(existing);
            const timer = setTimeout(
              () => rejectNext(new Error('Timeout auf ServerMessage')),
              3000,
            );
            waiters.push({
              predicate,
              resolve: (message) => {
                clearTimeout(timer);
                resolveNext(message);
              },
            });
          }),
      }),
    );
    socket.on('error', reject);
  });
}

describe('HostApp (WebSocket-Roundtrip)', () => {
  let app: HostApp | null = null;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of clients) socket.close();
    clients.length = 0;
    await app?.close();
    app = null;
  });

  async function setup(): Promise<{ port: number; bridge: FakeBridge }> {
    const bridge = new FakeBridge();
    bridge.cuePoints = [
      { name: 'Intro', timeBeats: 0 },
      { name: 'Outro', timeBeats: 64 },
    ];
    app = createHostApp({ bridge, serverVersion: '0.1.0-test' });
    await app.ready;
    await new Promise<void>((resolve) => app!.httpServer.listen(0, resolve));
    const { port } = app.httpServer.address() as AddressInfo;
    return { port, bridge };
  }

  it('liefert direkt nach Connect einen vollen Snapshot', async () => {
    const { port } = await setup();
    const client = await connectClient(port);
    clients.push(client.socket);

    const snapshot = await client.next((m) => m.type === 'snapshot');
    if (snapshot.type !== 'snapshot') throw new Error('unreachable');
    expect(snapshot.state.serverVersion).toBe('0.1.0-test');
    expect(snapshot.state.transport.bpm).toBe(120);
    expect(snapshot.state.bridge.connected).toBe(true);
    expect(snapshot.state.engine.jumpMode).toBe('quantized');
    expect(snapshot.state.activeSetlistId).toBe('default');
  });

  it('beantwortet ping mit pong (Latenz-Messung)', async () => {
    const { port } = await setup();
    const client = await connectClient(port);
    clients.push(client.socket);

    client.socket.send(serializeMessage({ type: 'ping', id: 7, sentAt: 12345 }));
    const pong = await client.next((m) => m.type === 'pong');
    if (pong.type !== 'pong') throw new Error('unreachable');
    expect(pong.id).toBe(7);
    expect(pong.sentAt).toBe(12345);
  });

  it('broadcastet Bridge-Events an mehrere Clients ohne State-Divergenz', async () => {
    const { port, bridge } = await setup();
    const clientA = await connectClient(port);
    const clientB = await connectClient(port);
    const clientC = await connectClient(port);
    clients.push(clientA.socket, clientB.socket, clientC.socket);

    bridge.emit('songLength', 128);
    bridge.emit('cuePoints', bridge.cuePoints);
    bridge.transport = { isPlaying: true, positionBeats: 65, bpm: 98, timeSig: [4, 4] };
    bridge.emit('transport', bridge.getTransport());

    for (const client of [clientA, clientB, clientC]) {
      const songsMsg = await client.next((m) => m.type === 'songs');
      if (songsMsg.type !== 'songs') throw new Error('unreachable');
      expect(songsMsg.songs.map((s) => s.title)).toEqual(['Intro', 'Outro']);
      expect(songsMsg.songs[1].lengthBeats).toBe(64);

      const setlistsMsg = await client.next((m) => m.type === 'setlists');
      if (setlistsMsg.type !== 'setlists') throw new Error('unreachable');
      expect(setlistsMsg.setlists[0].entries).toHaveLength(2);

      const transportMsg = await client.next(
        (m) => m.type === 'transport' && m.transport.isPlaying,
      );
      if (transportMsg.type !== 'transport') throw new Error('unreachable');
      expect(transportMsg.transport.bar).toBe(17);
      expect(transportMsg.transport.beat).toBe(2);
      expect(transportMsg.transport.currentSongId).toBe(songsMsg.songs[1].id);
    }
  });

  it('leitet Transport-Kommandos an die Bridge weiter', async () => {
    const { port, bridge } = await setup();
    const client = await connectClient(port);
    clients.push(client.socket);

    client.socket.send(serializeMessage({ type: 'command', command: { action: 'play' } }));
    client.socket.send(serializeMessage({ type: 'refreshLocators' }));

    await client.next((m) => m.type === 'songs');
    expect(bridge.actions).toContain('play');
    expect(bridge.actions).toContain('refreshCuePoints');
  });

  it('Queue-Kommando cuet einen Song über die Engine', async () => {
    const { port, bridge } = await setup();
    const client = await connectClient(port);
    clients.push(client.socket);

    // Songs laden
    bridge.emit('songLength', 128);
    bridge.emit('cuePoints', bridge.cuePoints);
    await client.next((m) => m.type === 'songs');

    // Transport steht → Queue führt sofort aus
    client.socket.send(serializeMessage({ type: 'queue', songId: 'outro@64' }));
    await client.next(
      (m) => m.type === 'engine' && m.engine.currentEntryId === 'default-1-outro@64',
    );
    expect(bridge.actions).toContain('pos:64');
  });

  it('Mixer-Kommandos erreichen die Bridge', async () => {
    const { port, bridge } = await setup();
    const client = await connectClient(port);
    clients.push(client.socket);

    client.socket.send(
      serializeMessage({ type: 'mixerSet', trackIndex: 2, field: 'volume', value: 0.5 }),
    );
    client.socket.send(
      serializeMessage({ type: 'mixerSet', trackIndex: 1, field: 'mute', value: true }),
    );
    client.socket.send(serializeMessage({ type: 'ping', id: 1, sentAt: 1 }));
    await client.next((m) => m.type === 'pong');
    expect(bridge.actions).toContain('vol:2:0.5');
    expect(bridge.actions).toContain('mute:1:true');
  });

  it('ignoriert kaputte Frames, ohne die Verbindung zu beenden', async () => {
    const { port } = await setup();
    const client = await connectClient(port);
    clients.push(client.socket);

    client.socket.send('{kaputt');
    client.socket.send('{"type":"unbekannt"}');
    client.socket.send(serializeMessage({ type: 'ping', id: 1, sentAt: 1 }));

    const pong = await client.next((m) => m.type === 'pong');
    expect(pong.type).toBe('pong');
  });
});
