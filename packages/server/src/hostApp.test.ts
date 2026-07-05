/**
 * WebSocket-Roundtrip-Test: Snapshot bei Connect, Ping/Pong, Broadcast bei
 * Bridge-Events, Kommandos erreichen die Bridge. Die Bridge ist hier ein
 * In-Memory-Fake (Mocks sind nur in Tests erlaubt).
 */

import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  WS_PATH,
  parseServerMessage,
  serializeMessage,
  type BridgeStatus,
  type CuePoint,
  type ServerMessage,
} from '@unableset/shared';
import type { AbletonBridge, AbletonBridgeEvents, BridgeTransport } from '@unableset/bridge';
import { createHostApp, type HostApp } from './hostApp.js';

class FakeBridge extends EventEmitter<AbletonBridgeEvents> implements AbletonBridge {
  commands: string[] = [];
  cuePoints: CuePoint[] = [
    { name: 'Intro', timeBeats: 0 },
    { name: 'Outro', timeBeats: 64 },
  ];
  private transport: BridgeTransport = {
    isPlaying: false,
    positionBeats: 0,
    bpm: 120,
    timeSig: [4, 4],
  };

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  getStatus(): BridgeStatus {
    return { kind: 'osc', connected: true, remoteAddress: '127.0.0.1', remotePort: 11000 };
  }

  getTransport(): BridgeTransport {
    return this.transport;
  }

  async refreshCuePoints(): Promise<CuePoint[]> {
    this.commands.push('refreshCuePoints');
    this.emit('cuePoints', this.cuePoints);
    return this.cuePoints;
  }

  play(): void {
    this.commands.push('play');
  }
  stop(): void {
    this.commands.push('stop');
  }
  continuePlayback(): void {
    this.commands.push('continue');
  }
  jumpToCuePoint(index: number): void {
    this.commands.push(`jump:${index}`);
  }
}

interface TestClient {
  socket: WebSocket;
  messages: ServerMessage[];
  next(predicate: (msg: ServerMessage) => boolean): Promise<ServerMessage>;
}

function connectClient(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
    const messages: ServerMessage[] = [];
    const waiters: { predicate: (msg: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

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
            const timer = setTimeout(() => rejectNext(new Error('Timeout auf ServerMessage')), 3000);
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
    app = createHostApp({ bridge, serverVersion: '0.1.0-test' });
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
    expect(pong.serverTime).toBeGreaterThan(0);
  });

  it('broadcastet Bridge-Events an mehrere Clients ohne Divergenz', async () => {
    const { port, bridge } = await setup();
    const clientA = await connectClient(port);
    const clientB = await connectClient(port);
    const clientC = await connectClient(port);
    clients.push(clientA.socket, clientB.socket, clientC.socket);

    bridge.emit('songLength', 128);
    bridge.emit('cuePoints', bridge.cuePoints);
    bridge.emit('transport', {
      isPlaying: true,
      positionBeats: 65,
      bpm: 98,
      timeSig: [4, 4],
    });

    for (const client of [clientA, clientB, clientC]) {
      const songsMsg = await client.next((m) => m.type === 'songs');
      if (songsMsg.type !== 'songs') throw new Error('unreachable');
      expect(songsMsg.songs.map((s) => s.title)).toEqual(['Intro', 'Outro']);
      expect(songsMsg.songs[1].lengthBeats).toBe(64);
      expect(songsMsg.setlist.entries).toHaveLength(2);

      const transportMsg = await client.next(
        (m) => m.type === 'transport' && m.transport.isPlaying,
      );
      if (transportMsg.type !== 'transport') throw new Error('unreachable');
      expect(transportMsg.transport.bar).toBe(17);
      expect(transportMsg.transport.beat).toBe(2);
      expect(transportMsg.transport.currentSongId).toBe(songsMsg.songs[1].id);
    }
  });

  it('leitet Kommandos an die Bridge weiter', async () => {
    const { port, bridge } = await setup();
    const client = await connectClient(port);
    clients.push(client.socket);

    client.socket.send(serializeMessage({ type: 'command', command: { action: 'play' } }));
    client.socket.send(
      serializeMessage({ type: 'command', command: { action: 'jumpToLocator', locatorIndex: 3 } }),
    );
    client.socket.send(serializeMessage({ type: 'refreshLocators' }));

    // refreshLocators löst einen songs-Broadcast aus — darauf warten
    await client.next((m) => m.type === 'songs');
    expect(bridge.commands).toEqual(['play', 'jump:3', 'refreshCuePoints']);
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
