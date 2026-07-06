/**
 * Verdrahtet Bridge, State-Store, Setlist-Engine, Persistenz, HTTP (Express)
 * und WebSocket-Server. Von index.ts (CLI) und von Tests genutzt.
 */

import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  WS_PATH,
  parseClientMessage,
  parseSongTitlesFromCsv,
  serializeMessage,
  setlistFromText,
  setlistToText,
  type ClientMessage,
  type CuePoint,
  type ProjectFileInfo,
  type ServerMessage,
  type Setlist,
  type Song,
} from '@unableset/shared';
import { buildSongsFromCuePoints, type AbletonBridge } from '@unableset/bridge';
import { HostStore } from './hostStore.js';
import { SetlistEngine } from './setlistEngine.js';
import { Persistence } from './persistence.js';
import { ClockScheduler } from './clockActions.js';
import { OscOut, type OscOutTarget } from './oscOut.js';
import { OSC_OUT } from '@unableset/shared';
import { MidiManager } from './midiMapping.js';
import { readJsonWithBackup } from './util/atomicWrite.js';
import { AblesetCompatServer } from './ablesetCompat.js';

export interface HostAppOptions {
  bridge: AbletonBridge;
  serverVersion: string;
  /** Pfad zum gebauten Client (wird statisch ausgeliefert, wenn vorhanden). */
  clientDistPath?: string;
  /** Datenordner für Setlists/Settings; ohne Angabe keine Persistenz (Tests). */
  dataDir?: string;
  /** Ziele für den OSC-Out-Feed (Floor-Displays, Licht, Video). */
  oscOutTargets?: OscOutTarget[];
  /** UDP-Port für die AbleSet-Companion-Kompatibilität (0 = aus). */
  ablesetPort?: number;
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
  let lastLyricLines: CuePoint[] = [];

  /** Lyric-Zeilen (aus MIDI-Clips) den Songs zeitlich zuordnen. */
  const attachTimedLyrics = (songs: Song[]): Song[] => {
    if (lastLyricLines.length === 0) return songs;
    return songs.map((song) => {
      const end = song.startBeat + song.lengthBeats;
      const lines = lastLyricLines
        .filter((line) => line.timeBeats >= song.startBeat && line.timeBeats < end)
        .map((line) => ({ beat: line.timeBeats, text: line.name }));
      return lines.length > 0 ? { ...song, timedLyrics: lines } : song;
    });
  };

  const rebuildSongs = () => {
    const songs = attachTimedLyrics(buildSongsFromCuePoints(lastCuePoints, songLengthBeats));
    // Engine zuerst — store.setSongs broadcastet sofort und der OSC-Out-Feed
    // löst Songs über engine.resolvedSong auf
    engine.setSongs(songs);
    store.setSongs(songs);
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
  bridge.on('lyricLines', (lines) => {
    lastLyricLines = lines;
    if (lastCuePoints.length > 0) rebuildSongs();
  });
  bridge.on('songLength', (length) => {
    if (length !== songLengthBeats) {
      songLengthBeats = length;
      if (lastCuePoints.length > 0) rebuildSongs();
    }
  });
  bridge.on('tracks', (tracks) => store.setTracks(tracks));
  bridge.on('mirrors', (mirrors) => store.setMirrors(mirrors));
  bridge.on('bridgeError', (error) => log(`Bridge-Fehler (ignoriert): ${error.message}`));

  // --- OSC-Out-Feed (Floor-Displays, Licht/Video) + oscOnEnter pro Song ------
  const oscOut = new OscOut(options.oscOutTargets ?? [], log);
  void oscOut.open().catch((error: Error) => log(`OSC-Out nicht verfügbar: ${error.message}`));

  let feedSongId: string | undefined;
  let feedSectionId: string | undefined;
  let feedPlaying: boolean | undefined;
  store.on('broadcast', (message) => {
    if (message.type !== 'transport') return;
    const transport = message.transport;

    if (transport.isPlaying !== feedPlaying) {
      feedPlaying = transport.isPlaying;
      oscOut.send({ address: OSC_OUT.playing, args: [transport.isPlaying ? 1 : 0] });
    }

    if (transport.currentSongId !== feedSongId) {
      feedSongId = transport.currentSongId;
      const setlist = store.getActiveSetlist();
      const engineState = engine.getState();
      let entryIndex = setlist.entries.findIndex(
        (entry) =>
          entry.entryId === engineState.currentEntryId &&
          entry.songId === transport.currentSongId,
      );
      if (entryIndex < 0) {
        // Engine hat (noch) keinen Eintrag — Fallback über die Song-ID
        entryIndex = setlist.entries.findIndex(
          (entry) => entry.songId === transport.currentSongId,
        );
      }
      const entry = entryIndex >= 0 ? setlist.entries[entryIndex] : undefined;
      const song = entry
        ? engine.resolvedSong(entry)
        : store.getSongs().find((candidate) => candidate.id === transport.currentSongId);

      oscOut.send({
        address: OSC_OUT.song,
        args: [entryIndex, song?.title ?? ''],
      });
      const nextEntry = setlist.entries[entryIndex + 1];
      const nextSong = nextEntry ? engine.resolvedSong(nextEntry) : undefined;
      oscOut.send({ address: OSC_OUT.next, args: [nextSong?.title ?? ''] });

      // Getimte externe Befehle des Songs (Licht-Preset, Video-Cue, …)
      if (song?.oscOnEnter && song.oscOnEnter.length > 0) {
        oscOut.sendAll(song.oscOnEnter);
      }
    }

    if (transport.currentSectionId !== feedSectionId) {
      feedSectionId = transport.currentSectionId;
      const song = store.getSongs().find((candidate) => candidate.id === transport.currentSongId);
      const section = song?.sections.find((candidate) => candidate.id === transport.currentSectionId);
      oscOut.send({ address: OSC_OUT.section, args: [section?.name ?? ''] });
    }
  });

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

  // --- AbleSet-Companion-Kompatibilität (OSC, Port 39051) -----------------------
  const ablesetCompat =
    options.ablesetPort && options.ablesetPort > 0
      ? new AblesetCompatServer(store, engine, bridge, { port: options.ablesetPort, log })
      : null;

  // --- MIDI (Learn-Modus; Hardware optional) ------------------------------------
  const remoteAction = (action: string) => {
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
      case 'prevSong':
        engine.prevSong(store.getTransport().timeSig);
        break;
      case 'jumpNow':
        engine.jumpNow(store.getTransport().timeSig);
        break;
    }
  };
  const midi = options.dataDir
    ? new MidiManager(options.dataDir, remoteAction, (state) => store.setMidi(state), log)
    : null;

  // --- Multi-File-Projekte (<data-dir>/projects.json) ----------------------------
  const openProject = (path: string) => {
    // Nur registrierte Projektdateien (Allowlist) — nie beliebige Pfade öffnen
    const project = store.getProjects().find((candidate) => candidate.path === path);
    if (!project) {
      log(`projectOpen abgelehnt (nicht in projects.json): ${path}`);
      return;
    }
    const [command, args] =
      process.platform === 'darwin'
        ? ['open', [project.path]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', project.path]]
          : ['xdg-open', [project.path]];
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.on('error', (error) => log(`Projekt öffnen fehlgeschlagen: ${error.message}`));
      child.unref();
      log(`Öffne Live-Projekt: ${project.name} (${project.path})`);
    } catch (error) {
      log(`Projekt öffnen fehlgeschlagen: ${error instanceof Error ? error.message : error}`);
    }
  };

  // --- Persistierten Zustand laden ---------------------------------------------
  const ready = (async () => {
    if (options.dataDir) {
      const projects = await readJsonWithBackup<ProjectFileInfo[]>(
        join(options.dataDir, 'projects.json'),
      );
      if (Array.isArray(projects)) {
        store.setProjects(
          projects.filter(
            (project) =>
              typeof project?.name === 'string' && typeof project?.path === 'string',
          ),
        );
      }
      await midi?.start();
    }
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
  })().then(async () => {
    // Nach dem Laden des Zustands: AbleSet-Kompatibilitäts-Server öffnen
    await ablesetCompat?.open().catch((error: Error) => {
      log(`AbleSet-Kompatibilität nicht verfügbar: ${error.message}`);
    });
  });

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
        bridge.refreshLyricLines().catch(() => undefined);
        break;
      case 'refreshLyrics':
        bridge.refreshLyricLines().catch((error: Error) => {
          log(`Lyrics-Refresh fehlgeschlagen: ${error.message}`);
        });
        break;

      // --- MIDI-Learn ---
      case 'midiLearnStart':
        midi?.learn(message.action);
        break;
      case 'midiLearnCancel':
        midi?.cancelLearn();
        break;
      case 'midiMappingDelete':
        midi?.deleteMapping(message.index);
        break;

      // --- Multi-File-Projekte ---
      case 'projectOpen':
        openProject(message.path);
        break;

      // --- Canvas & Scripting ---
      case 'sendOsc':
        if (
          typeof message.message?.address === 'string' &&
          message.message.address.startsWith('/') &&
          message.message.address.length <= 200
        ) {
          oscOut.send(message.message);
        }
        break;
      case 'sharedSet': {
        const valueOk =
          typeof message.value !== 'string' || message.value.length <= 1024;
        // Schlüsselanzahl deckeln (unbegrenztes Wachstum verhindern)
        const keyExists = message.key in store.getSnapshot().shared;
        const underCap = keyExists || Object.keys(store.getSnapshot().shared).length < 256;
        if (typeof message.key === 'string' && message.key.length <= 64 && valueOk && underCap) {
          store.setShared(message.key, message.value);
        }
        break;
      }

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
      case 'setlistImportText':
      case 'setlistImportCsv': {
        const text =
          message.type === 'setlistImportCsv'
            ? parseSongTitlesFromCsv(message.csv).join('\n')
            : message.text;
        const result = setlistFromText(text, store.getSongs());
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
  app.disable('x-powered-by');
  // Sicherheits-Header (ohne externe Deps). Die CSP erlaubt bewusst blob:
  // (Canvas-Script-Worker) und data: (QR-Code), aber keine Fremd-Hosts.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' blob:",
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join('; '),
    );
    next();
  });
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
  // maxPayload begrenzt einzelne Frames (Schutz gegen Speicher-Missbrauch);
  // 256 KB reichen für die größten legitimen Nachrichten (Setlist-Updates).
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH, maxPayload: 262_144 });

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

    // Grobe Ratenbegrenzung: ein amoklaufender Client (Bug/Angriff) darf den
    // Host nicht lahmlegen. 400 Nachrichten/Sekunde sind weit über jedem
    // legitimen Bedarf (10-Hz-Ping + Bedienung).
    let windowStart = 0;
    let countInWindow = 0;

    socket.on('message', (data) => {
      // Date.now steht im Server-Kontext zur Verfügung (kein Workflow-Sandbox)
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        countInWindow = 0;
      }
      countInWindow += 1;
      if (countInWindow > 400) {
        if (countInWindow === 401) log('WS-Client überschreitet Ratenlimit — Frames verworfen');
        return;
      }

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
      midi?.stop();
      ablesetCompat?.close();
      oscOut.close();
      store.off('broadcast', broadcast);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await persistence?.flush();
      await bridge.disconnect();
    },
  };
}
