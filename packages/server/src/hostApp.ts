/**
 * Verdrahtet Bridge, State-Store, HTTP (Express) und WebSocket-Server.
 * Von index.ts (CLI) und von Tests (mit injizierter Bridge) genutzt.
 */

import { createServer, type Server } from 'node:http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  WS_PATH,
  parseClientMessage,
  serializeMessage,
  type CuePoint,
  type ServerMessage,
} from '@unableset/shared';
import { buildSongsFromCuePoints, type AbletonBridge } from '@unableset/bridge';
import { HostStore } from './hostStore.js';

export interface HostAppOptions {
  bridge: AbletonBridge;
  serverVersion: string;
  /** Pfad zum gebauten Client (wird statisch ausgeliefert, wenn vorhanden). */
  clientDistPath?: string;
  log?: (message: string) => void;
}

export interface HostApp {
  httpServer: Server;
  store: HostStore;
  /** Fährt WS, HTTP und Bridge sauber herunter. */
  close(): Promise<void>;
}

export function createHostApp(options: HostAppOptions): HostApp {
  const { bridge, serverVersion } = options;
  const log = options.log ?? (() => {});

  const store = new HostStore(serverVersion, bridge.getStatus());

  // --- Bridge → Store -------------------------------------------------------
  let songLengthBeats: number | undefined;
  let lastCuePoints: CuePoint[] = [];

  const rebuildSongs = () => {
    store.setSongs(buildSongsFromCuePoints(lastCuePoints, songLengthBeats));
  };

  bridge.on('status', (status) => store.setBridgeStatus(status));
  bridge.on('transport', (transport) => store.applyBridgeTransport(transport));
  bridge.on('cuePoints', (cuePoints) => {
    lastCuePoints = cuePoints;
    rebuildSongs();
  });
  bridge.on('songLength', (length) => {
    if (length !== songLengthBeats) {
      songLengthBeats = length;
      if (lastCuePoints.length > 0) rebuildSongs();
    }
  });
  bridge.on('bridgeError', (error) => log(`Bridge-Fehler (ignoriert): ${error.message}`));

  // --- HTTP -----------------------------------------------------------------
  const app = express();
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: serverVersion });
  });
  app.get('/api/state', (_req, res) => {
    res.json(store.getSnapshot());
  });
  if (options.clientDistPath) {
    app.use(express.static(options.clientDistPath));
  }

  const httpServer = createServer(app);

  // --- WebSocket ------------------------------------------------------------
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  const broadcast = (message: ServerMessage) => {
    const frame = serializeMessage(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  };
  store.on('broadcast', broadcast);

  wss.on('connection', (socket) => {
    // Voller Snapshot bei jedem (Re)Connect — Grundprinzip des Protokolls
    socket.send(serializeMessage({ type: 'snapshot', state: store.getSnapshot() }));

    socket.on('message', (data) => {
      const message = parseClientMessage(
        typeof data === 'string' ? data : new Uint8Array(data as Buffer),
      );
      if (!message) {
        log('Ungültiger WS-Frame ignoriert');
        return;
      }
      switch (message.type) {
        case 'hello':
          log(`Client angemeldet: ${message.deviceName ?? 'unbenannt'} (${message.role ?? '-'})`);
          break;
        case 'ping':
          socket.send(
            serializeMessage({
              type: 'pong',
              id: message.id,
              sentAt: message.sentAt,
              serverTime: Date.now(),
            }),
          );
          break;
        case 'command':
          switch (message.command.action) {
            case 'play':
              bridge.play();
              break;
            case 'stop':
              bridge.stop();
              break;
            case 'continue':
              bridge.continuePlayback();
              break;
            case 'jumpToLocator':
              bridge.jumpToCuePoint(message.command.locatorIndex);
              break;
          }
          break;
        case 'refreshLocators':
          bridge.refreshCuePoints().catch((error: Error) => {
            log(`Cue-Point-Refresh fehlgeschlagen: ${error.message}`);
          });
          break;
      }
    });

    socket.on('error', (error) => log(`WS-Client-Fehler: ${error.message}`));
  });

  return {
    httpServer,
    store,
    close: async () => {
      store.off('broadcast', broadcast);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await bridge.disconnect();
    },
  };
}
