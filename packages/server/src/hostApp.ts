/**
 * Verdrahtet Bridge, State-Store, Setlist-Engine, Persistenz, HTTP (Express)
 * und WebSocket-Server. Von index.ts (CLI) und von Tests genutzt.
 */

import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  WS_PATH,
  parseClientMessage,
  serializeMessage,
  setlistFromText,
  setlistToText,
  type ClientMessage,
  type CuePoint,
  type ServerMessage,
  type Setlist,
} from '@unableset/shared';
import { buildSongsFromCuePoints, type AbletonBridge } from '@unableset/bridge';
import { HostStore } from './hostStore.js';
import { SetlistEngine } from './setlistEngine.js';
import { Persistence } from './persistence.js';
import { ClockScheduler } from './clockActions.js';

export interface HostAppOptions {
  bridge: AbletonBridge;
  serverVersion: string;
  /** Pfad zum gebauten Client (wird statisch ausgeliefert, wenn vorhanden). */
  clientDistPath?: string;
  /** Datenordner für Setlists/Settings; ohne Angabe keine Persistenz (Tests). */
  dataDir?: string;
  log?: (message: string) => void;
}

export interface HostApp {
  httpServer: Server;
  store: HostStore;
  engine: SetlistEngine;
  /** Wartet Persistenz-Load ab (vor listen() aufrufen). */
  ready: Promise<void>;
  /** Fährt WS, HTTP, Scheduler und Bridge sauber herunter. */
  close(): Promise<void>;
}

export function createHostApp(options: HostAppOptions): HostApp {
  const { bridge, serverVersion } = options;
  const log = options.log ?? (() => {});

  const store = new HostStore(serverVersion, bridge.getStatus());
  const engine = new SetlistEngine(bridge, log);
  const persistence = options.dataDir ? new Persistence(options.dataDir, log) : null;

  // --- Persistenz-Hilfen ------------------------------------------------------
  const persistSetlists = () => {
    persistence?.saveSetlists({
      activeSetlistId: store.getActiveSetlistId(),
      setlists: store.getSetlists(),
    });
  };
  const persistSettings = () => {
    const engineState = engine.getState();
    persistence?.saveSettings({
      jumpMode: engineState.jumpMode,
      safeMode: engineState.safeMode,
      preRollBars: engineState.preRollBars,
      hidePlayed: engineState.hidePlayed,
      clockRules: store.getClockRules(),
    });
  };

  // --- Engine → Store ---------------------------------------------------------
  engine.on('changed', (state) => store.setEngineState(state));

  // --- Bridge → Store/Engine --------------------------------------------------
  let songLengthBeats: number | undefined;
  let lastCuePoints: CuePoint[] = [];

  const rebuildSongs = () => {
    const songs = buildSongsFromCuePoints(lastCuePoints, songLengthBeats);
    store.setSongs(songs);
    engine.setSongs(songs);
    engine.setActiveSetlist(store.getActiveSetlist());
  };

  bridge.on('status', (status) => {
    store.setBridgeStatus(status);
    if (status.connected) {
      // Nach (Re)Connect Mixer-Zustand nachziehen
      bridge.refreshTracks().catch(() => undefined);
    }
  });
  bridge.on('transport', (transport) => {
    engine.handleTransportTick(transport);
    store.applyBridgeTransport(transport);
  });
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
  bridge.on('tracks', (tracks) => store.setTracks(tracks));
  bridge.on('bridgeError', (error) => log(`Bridge-Fehler (ignoriert): ${error.message}`));

  // --- Clock-Aktionen ----------------------------------------------------------
  const clock = new ClockScheduler(
    () => store.getClockRules(),
    (action) => {
      switch (action) {
        case 'play':
          bridge.play();
          break;
        case 'stop':
          bridge.stop();
          break;
        case 'continue':
          bridge.continuePlayback();
          break;
        case 'nextSong':
          engine.nextSong(store.getTransport().timeSig);
          break;
      }
    },
    log,
  );
  clock.start();

  // --- Persistierten Zustand laden ---------------------------------------------
  const ready = (async () => {
    if (!persistence) return;
    const [setlists, settings] = await Promise.all([
      persistence.loadSetlists(),
      persistence.loadSettings(),
    ]);
    if (setlists) {
      store.setSetlists(setlists.setlists, setlists.activeSetlistId);
      engine.setActiveSetlist(store.getActiveSetlist());
      log(`${setlists.setlists.length} Setlist(s) geladen`);
    }
    if (settings) {
      engine.restoreSettings({
        ...(settings.jumpMode ? { jumpMode: settings.jumpMode } : {}),
        ...(settings.safeMode !== undefined ? { safeMode: settings.safeMode } : {}),
        ...(settings.preRollBars !== undefined ? { preRollBars: settings.preRollBars } : {}),
        ...(settings.hidePlayed !== undefined ? { hidePlayed: settings.hidePlayed } : {}),
      });
      if (Array.isArray(settings.clockRules)) store.setClockRules(settings.clockRules);
    }
  })();

  // --- Client-Kommandos ---------------------------------------------------------
  const timeSig = () => store.getTransport().timeSig;

  function handleClientMessage(message: ClientMessage, socket: WebSocket): void {
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

      // --- Queue & Jumps ---
      case 'queue':
        engine.queue(message.songId, message.entryId, message.sectionId, timeSig());
        break;
      case 'clearQueue':
        engine.clearQueue();
        break;
      case 'jumpNow':
        engine.jumpNow(timeSig());
        break;
      case 'nextSong':
        engine.nextSong(timeSig());
        break;
      case 'prevSong':
        engine.prevSong(timeSig());
        break;
      case 'setJumpMode':
        engine.setJumpMode(message.mode);
        persistSettings();
        break;
      case 'setSafeMode':
        engine.setSafeMode(message.enabled);
        persistSettings();
        break;
      case 'setPreRoll':
        engine.setPreRoll(message.bars);
        persistSettings();
        break;
      case 'setHidePlayed':
        engine.setHidePlayed(message.enabled);
        persistSettings();
        break;
      case 'markPlayed':
        engine.markPlayed(message.entryId, message.played);
        break;
      case 'loopSection':
        engine.loopSection(message.songId, message.sectionId, message.enabled);
        break;

      // --- Setlist-Editor ---
      case 'setlistUpdate': {
        const setlists = store.getSetlists().map((setlist) =>
          setlist.id === message.setlist.id ? message.setlist : setlist,
        );
        store.setSetlists(setlists, store.getActiveSetlistId());
        if (message.setlist.id === store.getActiveSetlistId()) {
          engine.setActiveSetlist(message.setlist);
        }
        persistSetlists();
        break;
      }
      case 'setlistCreate': {
        const source = message.copyFromId
          ? store.getSetlists().find((setlist) => setlist.id === message.copyFromId)
          : undefined;
        const newSetlist: Setlist = {
          id: `setlist-${Date.now().toString(36)}`,
          name: message.name || 'Neue Setlist',
          entries: source
            ? source.entries.map((entry, index) => ({
                ...entry,
                entryId: `copy-${index}-${entry.songId}`,
              }))
            : [],
        };
        store.setSetlists([...store.getSetlists(), newSetlist], newSetlist.id);
        engine.setActiveSetlist(newSetlist);
        persistSetlists();
        break;
      }
      case 'setlistDelete': {
        if (message.setlistId === 'default') break; // Default ist nicht löschbar
        const remaining = store.getSetlists().filter((s) => s.id !== message.setlistId);
        const active =
          store.getActiveSetlistId() === message.setlistId
            ? 'default'
            : store.getActiveSetlistId();
        store.setSetlists(remaining, active);
        engine.setActiveSetlist(store.getActiveSetlist());
        persistSetlists();
        break;
      }
      case 'setlistActivate':
        store.setSetlists(store.getSetlists(), message.setlistId);
        engine.setActiveSetlist(store.getActiveSetlist());
        persistSetlists();
        break;
      case 'setlistImportText': {
        const result = setlistFromText(message.text, store.getSongs());
        if (result.unmatched.length > 0) {
          log(`Import: ${result.unmatched.length} Zeile(n) ohne Song-Match ignoriert`);
        }
        const imported: Setlist = {
          id: `setlist-${Date.now().toString(36)}`,
          name: message.name || 'Import',
          entries: result.entries,
        };
        store.setSetlists([...store.getSetlists(), imported], imported.id);
        engine.setActiveSetlist(imported);
        persistSetlists();
        break;
      }

      // --- Mixer ---
      case 'mixerRefresh':
        bridge.refreshTracks().catch(() => undefined);
        break;
      case 'mixerSet':
        if (message.field === 'volume' && typeof message.value === 'number') {
          bridge.setTrackVolume(message.trackIndex, message.value);
        } else if (message.field === 'mute') {
          bridge.setTrackMute(message.trackIndex, message.value === true);
        } else if (message.field === 'solo') {
          bridge.setTrackSolo(message.trackIndex, message.value === true);
        }
        break;

      // --- Clock-Regeln ---
      case 'clockRulesUpdate':
        store.setClockRules(message.rules);
        persistSettings();
        break;
    }
  }

  // --- HTTP ---------------------------------------------------------------------
  const app = express();
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: serverVersion });
  });
  app.get('/api/state', (_req, res) => {
    res.json(store.getSnapshot());
  });
  /** LAN-Adressen für QR-Code/Verbindungshinweis in den Clients. */
  app.get('/api/info', (req, res) => {
    const port = req.socket.localPort ?? 80;
    const urls: string[] = [];
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) {
          urls.push(`http://${entry.address}:${port}`);
        }
      }
    }
    res.json({ urls, version: serverVersion });
  });
  /** Plaintext-Export der aktiven Setlist (eine Zeile = ein Song). */
  app.get('/api/setlist/export.txt', (_req, res) => {
    res
      .type('text/plain')
      .send(setlistToText(store.getActiveSetlist(), store.getSongs()));
  });
  if (options.clientDistPath) {
    app.use(express.static(options.clientDistPath));
  }

  const httpServer = createServer(app);

  // --- WebSocket ------------------------------------------------------------------
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
      try {
        handleClientMessage(message, socket);
      } catch (error) {
        // Kein Client-Kommando darf den Host crashen
        log(`Kommando-Fehler (${message.type}): ${error instanceof Error ? error.message : error}`);
      }
    });

    socket.on('error', (error) => log(`WS-Client-Fehler: ${error.message}`));
  });

  return {
    httpServer,
    store,
    engine,
    ready,
    close: async () => {
      clock.stop();
      store.off('broadcast', broadcast);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await persistence?.flush();
      await bridge.disconnect();
    },
  };
}
